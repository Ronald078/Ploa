"""
Prospecção de Leads via OpenStreetMap e Overture Maps
==================================================================

O que este script faz:
1. Usa a API Nominatim para localizar cada cidade da lista informada (obtém
   a "bounding box" / área geográfica dela).
2. Usa a API Overpass para buscar estabelecimentos de categorias específicas
   (ex: restaurantes, salões de beleza) dentro de cada cidade.
3. Filtra apenas os estabelecimentos que:
   - NÃO têm o campo "website" nem "contact:website" preenchido no OSM, E
   - TÊM telefone ou WhatsApp válido no país pesquisado. Sem um número que
     o script de envio consiga reconhecer, não vira lead.
4. Tenta localizar outras formas de contato cadastradas (WhatsApp e
   Instagram), quando disponíveis no OpenStreetMap. O telefone já é salvo
   normalizado no padrão internacional E.164, pronto para o WhatsApp.
5. Salva o resultado SEMPRE no mesmo arquivo, "contatos.xlsx" — o mesmo
   nome que o enviar_mensagens_whatsapp.js já espera por padrão, pra você
   não precisar renomear nada manualmente entre um script e outro. A aba
   "Contatos" (a primeira aba, com cabeçalho "Nome"/"Telefone" sempre
   preenchido) é a que o script de envio vai ler. Além dela, também são
   criadas abas extras, uma por categoria (ex: "Restaurante"), só como
   referência visual — o script de envio não usa essas.
6. NUNCA sobrescreve leads antigos: se contatos.xlsx já existe, os leads
   que já estavam nele são preservados e os leads novos desta execução são
   ACRESCENTADOS ao mesmo arquivo (não cria mais _2.xlsx, _3.xlsx...).
7. NUNCA repete um lead já exportado anteriormente: o script mantém um
   registro (arquivo leads_ja_capturados.json, criado automaticamente na
   mesma pasta) com todos os leads já exportados em execuções passadas.
   A cada nova execução, qualquer lead que já esteja nesse registro é
   ignorado — só entram no Excel os leads realmente NOVOS.
   ⚠️ Não apague nem edite o arquivo leads_ja_capturados.json manualmente,
   ou o script pode voltar a exportar leads repetidos.

Fontes usadas (gratuitas, sem necessidade de chave/API key):
- Nominatim: https://nominatim.openstreetmap.org
- Overpass:  https://overpass-api.de/api/interpreter
- Overture:  https://overturemaps.org

Como rodar:
    pip install requests openpyxl overturemaps phonenumbers
    python buscar_leads.py

Você pode editar as variáveis CIDADES e CATEGORIAS lá embaixo, na seção
"CONFIGURAÇÃO", para adicionar/remover cidades e categorias.

IMPORTANTE - Uso responsável das APIs:
- O Nominatim pede um User-Agent identificável e no máximo 1 requisição por
  segundo. Já deixei isso configurado no script.
- O Overpass também é um serviço público mantido por voluntários — evite
  rodar o script em loop agressivo ou com muitas categorias/cidades ao mesmo
  tempo. Para volumes grandes, considere hospedar sua própria instância
  Overpass ou usar um provedor pago (ex: Overpass API comercial).
- Quanto MAIS cidades você colocar na lista CIDADES, mais tempo o script vai
  levar (é sequencial, uma cidade por vez, com pausas entre elas). Para uma
  lista grande (10+ cidades) ou cidades muito populosas (São Paulo, Rio),
  a execução pode levar vários minutos — isso é esperado e necessário para
  não sobrecarregar os servidores públicos gratuitos.
"""

import json
import hashlib
import os
import re
import time
import sys
import unicodedata
import threading
import queue
from crm.search_persistence import write_json_atomic, read_json_recoverable
from crm.search_persistence import valid_search_progress as validar_progresso_busca
from crm.search_checkpoint import SearchCheckpoint
from crm.runtime_paths import data_root
from crm.search_overpass import (OverpassClient, OverpassEmEspera, query_overpass,
                                 retry_cities, HTTP_TIMEOUT, RETRY_DELAYS)

if os.environ.get("PLOA_PANEL_OUTPUT") == "1":
    # Pipes são bufferizados por padrão; publique cada registro sem esperar a cidade.
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
    print("Preparando a busca e carregando bibliotecas...", flush=True)

import requests
from crm.search_excel import read_leads, write_leads


class ParadaBusca(SystemExit):
    """Interrompe uma consulta sem marcá-la como concluída."""


def acao_controle_painel():
    if os.environ.get("PLOA_PANEL_OUTPUT") != "1":
        return "resume"
    controle = os.path.join(data_root(), "ploa_controle.json")
    try:
        with open(controle, encoding="utf-8") as arquivo:
            return json.load(arquivo).get("search", {}).get("action", "resume")
    except (OSError, ValueError, TypeError, AttributeError):
        return "resume"


def verificar_parada_painel():
    if acao_controle_painel() == "stop":
        raise ParadaBusca(0)


def consulta_interrompivel(consultar, *args, **kwargs):
    """Só a leitura externa roda em thread; checkpoints/Excel ficam na principal.

    Ao parar, descarta a consulta incompleta e termina o processo, sem aguardar
    timeout/retries do provedor. A thread daemon nunca exporta dados.
    """
    if os.environ.get("PLOA_PANEL_OUTPUT") != "1":
        return consultar(*args, **kwargs)
    verificar_parada_painel()
    resultado = queue.Queue(maxsize=1)

    def executar():
        try:
            resultado.put((True, consultar(*args, **kwargs)))
        except BaseException as erro:
            resultado.put((False, erro))

    threading.Thread(target=executar, daemon=True).start()
    while True:
        verificar_parada_painel()
        try:
            sucesso, valor = resultado.get(timeout=0.2)
        except queue.Empty:
            continue
        verificar_parada_painel()
        if not sucesso:
            raise valor
        return valor


def esperar_interrompivel(segundos):
    fim = time.monotonic() + segundos
    while True:
        verificar_parada_painel()
        restante = fim - time.monotonic()
        if restante <= 0:
            return
        time.sleep(min(0.2, restante))


def aguardar_controle_painel(andamento):
    """Pausa somente entre cidades, depois de salvar o progresso."""
    if os.environ.get("PLOA_PANEL_OUTPUT") != "1":
        return
    pausada = False
    while True:
        acao = acao_controle_painel()
        if acao == "stop":
            raise ParadaBusca(0)
        if acao != "pause":
            if pausada:
                andamento["status"] = "em_execucao"
                salvar_andamento_busca(andamento)
            return
        if not pausada:
            andamento["status"] = "pausada"
            salvar_andamento_busca(andamento)
            print("Busca pausada entre cidades. Progresso preservado.", flush=True)
            pausada = True
        time.sleep(0.2)

try:
    import phonenumbers
except ImportError:
    phonenumbers = None

record_batch_reader = None
overture_importado = False

# Evita que os símbolos já usados nas mensagens do script derrubem a execução
# em versões do PowerShell/Python que ainda iniciam o console como cp1252.
for fluxo in (sys.stdout, sys.stderr):
    if hasattr(fluxo, "reconfigure"):
        fluxo.reconfigure(encoding="utf-8", errors="replace")

# =========================================================================
# CONFIGURAÇÃO
# =========================================================================

# Mercados e cidades. Brasil e Portugal ficam ativos agora. Estados Unidos e
# Espanha já estão preparados e entram automaticamente quando houver pelo
# menos uma copy no respectivo bloco de copys_internacionais.json.
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "crm", "search-catalog.json"), "r", encoding="utf-8") as _catalogo_arquivo:
    _catalogo_busca = json.load(_catalogo_arquivo)
MERCADOS = _catalogo_busca["markets"]

# Estas estruturas são preenchidas depois que o caminho do arquivo de copys
# for conhecido. O restante do programa continua trabalhando com CIDADES.
CIDADES = []
CONFIGURACAO_CIDADES = {}

# Mapeamento: nome amigável -> alternativas de tags OSM.
# Dentro de cada alternativa, todos os pares precisam existir no mesmo
# estabelecimento; alternativas diferentes são unidas na consulta.
# Você pode adicionar outras categorias consultando https://wiki.openstreetmap.org/wiki/Map_Features
CATEGORIAS = {
    nome: [[tuple(par) for par in alternativa] for alternativa in alternativas]
    for nome, alternativas in _catalogo_busca["categories"].items()
}

# Segunda fonte gratuita, disponível em todas as cidades da busca,
# inclusive localidades adicionadas pelo painel nos quatro mercados.
ATIVAR_OVERTURE = True
CIDADES_OVERTURE = set()
CONFIANCA_MINIMA_OVERTURE = 0.70

ARQUIVO_SAIDA = "contatos.xlsx"  # nome fixo — o mesmo que enviar_mensagens_whatsapp.js lê
ARQUIVO_REGISTRO = "leads_ja_capturados.json"  # guarda todos os leads já exportados, pra nunca repetir
ARQUIVO_CACHE_CIDADES = "cache_cidades.json"
ARQUIVO_PROGRESSO = "progresso_busca.json"
ARQUIVO_ANDAMENTO = "andamento_busca.json"
ARQUIVO_COPYS_INTERNACIONAIS = "copys_internacionais.json"
ARQUIVO_CONFIGURACOES_OPERACAO = "configuracoes_operacao.json"

# Garante que os arquivos são sempre salvos/lidos na MESMA pasta onde o
# script está, não importa de qual diretório você rode o comando.
PASTA_DO_SCRIPT = data_root()
CAMINHO_REGISTRO = os.path.join(PASTA_DO_SCRIPT, ARQUIVO_REGISTRO)
CAMINHO_SAIDA = os.path.join(PASTA_DO_SCRIPT, ARQUIVO_SAIDA)
CAMINHO_CACHE_CIDADES = os.path.join(PASTA_DO_SCRIPT, ARQUIVO_CACHE_CIDADES)
CAMINHO_PROGRESSO = os.path.join(PASTA_DO_SCRIPT, ARQUIVO_PROGRESSO)
CAMINHO_ANDAMENTO = os.path.join(PASTA_DO_SCRIPT, ARQUIVO_ANDAMENTO)
CAMINHO_COPYS_INTERNACIONAIS = os.path.join(PASTA_DO_SCRIPT, ARQUIVO_COPYS_INTERNACIONAIS)
CAMINHO_CONFIGURACOES_OPERACAO = os.path.join(PASTA_DO_SCRIPT, ARQUIVO_CONFIGURACOES_OPERACAO)


def _carregar_copys_internacionais() -> dict:
    try:
        with open(CAMINHO_COPYS_INTERNACIONAIS, "r", encoding="utf-8") as arquivo:
            dados = json.load(arquivo)
            return dados if isinstance(dados, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def _mercado_tem_alguma_copy(nome_mercado: str, copys: dict) -> bool:
    configuracao = copys.get(nome_mercado) or {}
    genericas = configuracao.get("genericas") or []
    por_categoria = configuracao.get("porCategoria") or {}
    return bool(genericas) or any(bool(opcoes) for opcoes in por_categoria.values())


def _preparar_mercados_ativos():
    copys = _carregar_copys_internacionais()
    for nome_mercado, configuracao in MERCADOS.items():
        ativo = bool(configuracao.get("ativo"))
        if configuracao.get("ativar_quando_houver_copys"):
            ativo = ativo or _mercado_tem_alguma_copy(nome_mercado, copys)
        if not ativo:
            continue

        for cidade in configuracao["cidades"]:
            CIDADES.append(cidade)
            CONFIGURACAO_CIDADES[cidade] = {
                "pais": nome_mercado,
                "iso": configuracao["iso"],
                "ddi": configuracao["ddi"],
                "idioma": configuracao["idioma"],
            }


def _carregar_configuracoes_operacao() -> dict:
    try:
        with open(CAMINHO_CONFIGURACOES_OPERACAO, "r", encoding="utf-8") as arquivo:
            dados = json.load(arquivo)
            return dados if isinstance(dados, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def _aplicar_configuracoes_adicionais():
    configuracoes = _carregar_configuracoes_operacao()
    busca = configuracoes.get("search") or {}

    for item in busca.get("localities") or []:
        if not isinstance(item, dict):
            continue
        cidade = str(item.get("city") or "").strip()
        nome_mercado = str(item.get("market") or "").strip()
        mercado = MERCADOS.get(nome_mercado)
        if not cidade or not mercado or cidade in CONFIGURACAO_CIDADES:
            continue

        CIDADES.append(cidade)
        CONFIGURACAO_CIDADES[cidade] = {
            "pais": nome_mercado,
            "iso": mercado["iso"],
            "ddi": mercado["ddi"],
            "idioma": mercado["idioma"],
        }

    for item in busca.get("categories") or []:
        if not isinstance(item, dict):
            continue
        nome = str(item.get("name") or "").strip()
        chave = str(item.get("key") or "").strip()
        valor = str(item.get("value") or "").strip()
        if not nome or not chave or not valor:
            continue

        alternativa = [(chave, valor)]
        alternativas = CATEGORIAS.setdefault(nome, [])
        if alternativa not in alternativas:
            alternativas.append(alternativa)


_preparar_mercados_ativos()
_aplicar_configuracoes_adicionais()
CIDADES_OVERTURE.update(CIDADES)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

# Instâncias públicas podem falhar ou impor espera. O cliente prioriza as
# disponíveis, respeita cooldown/Retry-After e não paraleliza as consultas.
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]

# Nominatim exige um User-Agent identificável (política de uso do serviço)
HEADERS = {
    "User-Agent": "ProspeccaoLeadsScript/1.0 (uso pessoal para prospeccao de clientes)",
    "Accept": "application/json",
}

# Mantém conexões HTTP abertas entre consultas, reduzindo o custo de criar uma
# nova conexão TLS para cada consulta.
SESSAO_HTTP = requests.Session()
SESSAO_HTTP.headers.update(HEADERS)

# Timeouts separados: uma conexão que nem abre falha rápido; uma consulta que
# já começou ainda recebe tempo suficiente para o Overpass responder.
TIMEOUT_NOMINATIM = (10, 30)
TIMEOUT_OVERPASS = HTTP_TIMEOUT
ESPERAS_RETOMADA = RETRY_DELAYS
PAUSA_ENTRE_CATEGORIAS_SEGUNDOS = 1
PAUSA_ENTRE_CIDADES_SEGUNDOS = 1

# =========================================================================
# FUNÇÕES
# =========================================================================


def salvar_json_atomico(caminho_arquivo: str, dados):
    """Grava JSON sem deixar um arquivo parcial se o processo for interrompido."""
    write_json_atomic(caminho_arquivo, dados)


def carregar_cache_cidades() -> dict:
    try:
        with open(CAMINHO_CACHE_CIDADES, "r", encoding="utf-8") as f:
            dados = json.load(f)
            return dados if isinstance(dados, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


CACHE_CIDADES = carregar_cache_cidades()


def obter_bounding_box(cidade: str):
    """Consulta o Nominatim para obter a bounding box (área) da cidade."""
    chave_cache = cidade.strip().casefold()
    bbox_cache = CACHE_CIDADES.get(chave_cache)
    if isinstance(bbox_cache, list) and len(bbox_cache) == 4:
        print("   Bounding box reutilizada do cache local.")
        return tuple(float(valor) for valor in bbox_cache)

    params = {
        "q": cidade,
        "format": "json",
        "limit": 1,
    }
    resp = consulta_interrompivel(SESSAO_HTTP.get,
        NOMINATIM_URL,
        params=params,
        timeout=TIMEOUT_NOMINATIM,
    )
    resp.raise_for_status()
    dados = resp.json()

    if not dados:
        raise ValueError(f"Não foi possível encontrar a cidade: {cidade}")

    # boundingbox vem como [south, north, west, east] (strings)
    bbox = dados[0]["boundingbox"]
    sul, norte, oeste, leste = map(float, bbox)
    bbox_overpass = (sul, oeste, norte, leste)
    CACHE_CIDADES[chave_cache] = list(bbox_overpass)
    salvar_json_atomico(CAMINHO_CACHE_CIDADES, CACHE_CIDADES)
    return bbox_overpass  # Overpass espera (south, west, north, east)


def montar_query_overpass(bbox, alternativas_filtros):
    return query_overpass(bbox, alternativas_filtros)


CLIENTE_OVERPASS = None


def buscar_estabelecimentos(bbox, alternativas_filtros, estado=None, ao_salvar=None):
    global CLIENTE_OVERPASS
    if CLIENTE_OVERPASS is None:
        CLIENTE_OVERPASS = OverpassClient(
            OVERPASS_URLS, SESSAO_HTTP, consulta_interrompivel,
            verificar_parada_painel, esperar_interrompivel,
        )
    return CLIENTE_OVERPASS.search(bbox, alternativas_filtros, estado, ao_salvar)


def tem_site(tags: dict) -> bool:
    """Verifica se o estabelecimento já tem site cadastrado no OSM."""
    return any(
        bool(tags.get(chave))
        for chave in ("website", "contact:website", "url", "contact:url")
    )


def montar_endereco(tags: dict) -> str:
    """Monta uma string de endereço a partir das tags addr:* do OSM."""
    partes = []
    rua = tags.get("addr:street", "")
    numero = tags.get("addr:housenumber", "")
    bairro = tags.get("addr:suburb", "")
    cidade = tags.get("addr:city", "")

    if rua:
        partes.append(f"{rua}, {numero}".strip(", "))
    if bairro:
        partes.append(bairro)
    if cidade:
        partes.append(cidade)

    return " - ".join(partes) if partes else "Endereço não informado no OSM"


def configuracao_da_cidade(cidade: str) -> dict:
    """Retorna o mercado da cidade; preserva Brasil como fallback legado."""
    return CONFIGURACAO_CIDADES.get(cidade, {
        "pais": "Brasil",
        "iso": "BR",
        "ddi": "55",
        "idioma": "pt-BR",
    })


def configuracao_do_lead(lead: dict) -> dict:
    pais = str(lead.get("País") or "").strip()
    if pais in MERCADOS:
        mercado = MERCADOS[pais]
        return {
            "pais": pais,
            "iso": mercado["iso"],
            "ddi": mercado["ddi"],
            "idioma": mercado["idioma"],
        }
    return configuracao_da_cidade(str(lead.get("Cidade") or ""))


def limpar_telefone(numero: str, regiao_padrao: str = "BR", ddi_padrao: str = "55") -> str:
    """Normaliza um ou mais telefones válidos para o padrão internacional E.164."""
    def _limpar_um(tel: str) -> str:
        tel = tel.strip()
        if not tel:
            return ""

        # URLs wa.me e links com ?phone= aparecem em alguns cadastros OSM.
        correspondencia_url = re.search(r"(?:wa\.me/|[?&]phone=)(\+?\d+)", tel, re.IGNORECASE)
        if correspondencia_url:
            tel = f"+{re.sub(r'\D', '', correspondencia_url.group(1))}"
        elif tel.startswith("00"):
            tel = f"+{re.sub(r'\D', '', tel)[2:]}"

        if phonenumbers is None:
            return ""

        candidatos = [(tel, regiao_padrao)]
        digitos = re.sub(r"\D", "", tel)
        if not tel.startswith("+") and digitos.startswith(str(ddi_padrao)):
            candidatos.append((f"+{digitos}", None))

        for candidato, regiao in candidatos:
            try:
                analisado = phonenumbers.parse(candidato, regiao)
            except phonenumbers.NumberParseException:
                continue
            if not phonenumbers.is_possible_number(analisado):
                continue
            return phonenumbers.format_number(
                analisado,
                phonenumbers.PhoneNumberFormat.E164,
            )
        return ""

    bruto = str(numero or "").strip()
    if not bruto:
        return ""

    # Não quebra as barras de uma URL; fora de URLs, aceita também "/" como
    # separador de múltiplos telefones, além de ponto e vírgula, vírgula e "|".
    separador = r"[;,|]+" if "://" in bruto else r"[;,|/]+"
    partes = re.split(separador, bruto)
    telefones = []
    for parte in partes:
        telefone = _limpar_um(parte)
        if telefone and telefone not in telefones:
            telefones.append(telefone)
    return "; ".join(telefones)


def obter_telefone(tags: dict, configuracao_cidade: dict = None) -> str:
    """Tenta extrair telefone de diferentes variações de tag usadas no OSM,
    já retornando no padrão internacional E.164."""
    configuracao_cidade = configuracao_cidade or configuracao_da_cidade("")
    for chave in (
        "phone",
        "contact:phone",
        "contact:mobile",
        "mobile",
        "contact:whatsapp",
        "whatsapp",
    ):
        if tags.get(chave):
            telefone = limpar_telefone(
                tags[chave],
                configuracao_cidade["iso"],
                configuracao_cidade["ddi"],
            )
            if telefone:
                return telefone
    return "Não informado"


def obter_outros_contatos(tags: dict) -> str:
    """Tenta extrair outras formas de contato cadastradas no OSM:
    WhatsApp e Instagram. Retorna uma string única juntando tudo que foi
    encontrado (ex: "WhatsApp: 71999999999 | Instagram: @nome"),
    ou "Não encontrado" se nada disso estiver cadastrado.
    """
    achados = []

    whatsapp = (
        tags.get("contact:whatsapp")
        or tags.get("whatsapp")
    )
    if whatsapp:
        achados.append(f"WhatsApp: {whatsapp}")

    instagram = tags.get("contact:instagram") or tags.get("instagram")
    if instagram:
        # Às vezes vem como URL completa, às vezes só o @usuario
        achados.append(f"Instagram: {instagram}")

    return " | ".join(achados) if achados else "Não encontrado"


def chave_unica_do_lead(lead: dict) -> str:
    """Gera uma chave única pra identificar um lead, usada para nunca repetir
    o mesmo estabelecimento entre execuções do script.

    Usamos Nome + Cidade + Telefone porque o mesmo nome pode existir em
    cidades diferentes (ex: duas lanchonetes "Point" em cidades distintas),
    e o telefone ajuda a diferenciar estabelecimentos com nomes parecidos
    na mesma cidade.
    """
    nome = (lead.get("Nome") or "").strip().lower()
    cidade = (lead.get("Cidade") or "").strip().lower()
    telefone = (lead.get("Telefone") or "").strip().lower()
    return f"{nome}|{cidade}|{telefone}"


def carregar_registro_de_leads(caminho_registro: str) -> set:
    """Carrega o conjunto de chaves de leads já exportados em execuções
    anteriores. Se o arquivo de registro não existir ainda, retorna vazio.
    """
    if not os.path.exists(caminho_registro):
        return set()

    try:
        with open(caminho_registro, "r", encoding="utf-8") as f:
            dados = json.load(f)
            return set(dados.get("chaves_ja_exportadas", []))
    except (json.JSONDecodeError, OSError) as e:
        print(f"⚠️  Não foi possível ler o registro de leads anteriores ({e}). Começando do zero.")
        return set()


def salvar_registro_de_leads(caminho_registro: str, chaves_atualizadas: set):
    """Salva o conjunto atualizado de chaves de leads já exportados,
    para que a próxima execução do script não repita nenhum deles.
    """
    salvar_json_atomico(
        caminho_registro,
        {"chaves_ja_exportadas": sorted(chaves_atualizadas)},
    )


def descrever_alternativas_filtros(alternativas_filtros: list) -> str:
    return " OU ".join(
        " + ".join(f"{chave}={valor}" for chave, valor in filtros)
        for filtros in alternativas_filtros
    )


def categoria_mais_especifica(nome_categoria: str, tags: dict, nome: str) -> str:
    """Corrige barbearias cadastradas apenas como salão genérico no OSM."""
    nome_normalizado = str(nome or "").casefold()
    if nome_categoria == "Salão de beleza" and (
        tags.get("hairdresser") == "barber"
        or "barbear" in nome_normalizado
        or "barber" in nome_normalizado
    ):
        return "Barbearia"
    return nome_categoria


def _primeiro_texto(valor) -> str:
    """Extrai um texto útil de campos simples ou estruturados do Overture."""
    if isinstance(valor, str):
        return valor.strip()
    if isinstance(valor, dict):
        for chave in ("primary", "common", "value", "name"):
            texto = _primeiro_texto(valor.get(chave))
            if texto:
                return texto
        for item in valor.values():
            texto = _primeiro_texto(item)
            if texto:
                return texto
    if isinstance(valor, (list, tuple)):
        for item in valor:
            texto = _primeiro_texto(item)
            if texto:
                return texto
    return ""


def _valores_taxonomia_overture(registro: dict) -> set:
    taxonomia = registro.get("taxonomy") or {}
    valores = [
        registro.get("basic_category"),
        taxonomia.get("primary"),
        *(taxonomia.get("hierarchy") or []),
        *(taxonomia.get("alternates") or []),
    ]
    return {
        str(valor).strip().casefold()
        for valor in valores
        if valor
    }


def classificar_categoria_overture(registro: dict):
    """Converte a taxonomia do Overture para as 8 categorias da campanha."""
    valores = _valores_taxonomia_overture(registro)

    def contem(*fragmentos):
        return any(
            fragmento in valor
            for valor in valores
            for fragmento in fragmentos
        )

    # As categorias mais específicas vêm primeiro para não transformar
    # barbearias em salões nem dentistas em clínicas genéricas.
    if contem("dentist", "dental_clinic", "orthodont"):
        return "Clínica odontológica"
    if contem("barber"):
        return "Barbearia"
    if contem("pet_store", "pet_shop", "pet_supply"):
        return "Pet shop"
    if contem("fitness", "gym"):
        return "Academia"
    if contem("clothing", "clothes", "fashion_store", "apparel"):
        return "Loja de roupa"
    if contem("hair_salon", "hairdresser", "beauty_salon"):
        return "Salão de beleza"
    if contem("skin_care", "aesthetic", "nail_salon", "beauty"):
        return "Clínica de estética"
    if contem("restaurant", "fast_food"):
        return "Restaurante"
    return None


def _endereco_overture(registro: dict) -> str:
    enderecos = registro.get("addresses") or []
    if not enderecos:
        return "Endereço não informado no Overture"

    endereco = enderecos[0] or {}
    livre = str(endereco.get("freeform") or "").strip()
    localidade = str(endereco.get("locality") or "").strip()
    regiao = str(endereco.get("region") or "").strip()
    cep = str(endereco.get("postcode") or "").strip()
    partes = [parte for parte in (livre, localidade, regiao, cep) if parte]
    return " - ".join(dict.fromkeys(partes)) or "Endereço não informado no Overture"


def _outros_contatos_overture(registro: dict) -> str:
    contatos = []
    for social in registro.get("socials") or []:
        texto = _primeiro_texto(social)
        if texto:
            contatos.append(f"Rede social: {texto}")
    for email in registro.get("emails") or []:
        texto = _primeiro_texto(email)
        if texto:
            contatos.append(f"E-mail: {texto}")
    return " | ".join(contatos[:3]) if contatos else "Não encontrado"


def coletar_leads_overture(cidade: str, bbox):
    """Busca a fonte complementar em qualquer cidade incluída na operação."""
    global record_batch_reader, overture_importado
    configuracao_cidade = configuracao_da_cidade(cidade)
    resumo = {
        "elementos": 0,
        "fora_das_categorias": 0,
        "baixa_confianca": 0,
        "fechados": 0,
        "sem_nome": 0,
        "com_site": 0,
        "sem_telefone": 0,
        "leads_validos": 0,
    }

    if not ATIVAR_OVERTURE or cidade not in CIDADES_OVERTURE:
        return [], True, resumo
    if not overture_importado:
        print("   Carregando a fonte Overture Maps...", flush=True)
        try:
            from overturemaps import record_batch_reader
        except ImportError:
            record_batch_reader = None
        overture_importado = True
    if record_batch_reader is None:
        print("   ⚠️  O pacote overturemaps não está instalado. Execute: pip install overturemaps")
        return [], False, resumo

    # OSM usa (sul, oeste, norte, leste); o Overture usa
    # (oeste, sul, leste, norte).
    sul, oeste, norte, leste = bbox
    bbox_overture = (oeste, sul, leste, norte)
    print(f"\n🌐 Consultando Overture Maps para: {cidade}...")

    try:
        leitor = record_batch_reader("place", bbox=bbox_overture,
                                    connect_timeout=10, request_timeout=45, stac=True)
        if leitor is None:
            print("   Nenhum estabelecimento retornado pelo Overture.")
            return [], True, resumo

        leads = []
        telefones_vistos = set()
        for lote in leitor:
            for registro in lote.to_pylist():
                resumo["elementos"] += 1

                if str(registro.get("operating_status") or "").casefold() == "permanently_closed":
                    resumo["fechados"] += 1
                    continue

                categoria = classificar_categoria_overture(registro)
                if not categoria:
                    resumo["fora_das_categorias"] += 1
                    continue

                confianca = registro.get("confidence")
                if confianca is not None and float(confianca) < CONFIANCA_MINIMA_OVERTURE:
                    resumo["baixa_confianca"] += 1
                    continue

                nome = _primeiro_texto(registro.get("names")) or _primeiro_texto(registro.get("brand"))
                if not nome:
                    resumo["sem_nome"] += 1
                    continue

                websites = [site for site in (registro.get("websites") or []) if _primeiro_texto(site)]
                if websites:
                    resumo["com_site"] += 1
                    continue

                telefones_brutos = [
                    _primeiro_texto(telefone)
                    for telefone in (registro.get("phones") or [])
                ]
                telefone = limpar_telefone(
                    "; ".join(filter(None, telefones_brutos)),
                    configuracao_cidade["iso"],
                    configuracao_cidade["ddi"],
                )
                if not telefone:
                    resumo["sem_telefone"] += 1
                    continue

                numeros = set(telefone.split("; "))
                if numeros & telefones_vistos:
                    continue
                telefones_vistos.update(numeros)

                leads.append({
                    "Nome": nome,
                    "Categoria": categoria,
                    "Cidade": cidade,
                    "Endereço": _endereco_overture(registro),
                    "Telefone": telefone,
                    "Site cadastrado no OSM": "Não",
                    "Outro contato (WhatsApp/Instagram)": _outros_contatos_overture(registro),
                    "Fonte": "Overture Maps",
                    "ID da fonte": str(registro.get("id") or ""),
                    "Confiança": "" if confianca is None else f"{float(confianca):.3f}",
                    "País": configuracao_cidade["pais"],
                    "DDI": configuracao_cidade["ddi"],
                    "Idioma": configuracao_cidade["idioma"],
                })
                resumo["leads_validos"] += 1

        print(
            f"   Overture: {resumo['elementos']} lugares analisados; "
            f"{resumo['leads_validos']} leads compatíveis."
        )
        print(
            "   Descartados no Overture: "
            f"fora das categorias={resumo['fora_das_categorias']}, "
            f"baixa confiança={resumo['baixa_confianca']}, fechados={resumo['fechados']}, "
            f"sem nome={resumo['sem_nome']}, com site={resumo['com_site']}, "
            f"sem telefone={resumo['sem_telefone']}"
        )
        return leads, True, resumo
    except Exception as erro:
        print(f"   ⚠️  Falha ao consultar o Overture para {cidade}: {erro}")
        return [], False, resumo


def _normalizar_texto_comparacao(valor) -> str:
    texto = unicodedata.normalize("NFKD", str(valor or "").casefold())
    texto = "".join(caractere for caractere in texto if not unicodedata.combining(caractere))
    return re.sub(r"[^a-z0-9]+", "", texto)


def telefones_do_lead(lead: dict) -> set:
    configuracao = configuracao_do_lead(lead)
    telefone = limpar_telefone(
        lead.get("Telefone") or "",
        configuracao["iso"],
        configuracao["ddi"],
    )
    return {numero for numero in telefone.split("; ") if numero}


def _chave_nome_endereco(lead: dict):
    nome = _normalizar_texto_comparacao(lead.get("Nome"))
    cidade = _normalizar_texto_comparacao(lead.get("Cidade"))
    endereco = _normalizar_texto_comparacao(lead.get("Endereço"))
    return nome, cidade, endereco


def mesclar_leads_das_fontes(leads_osm: list, leads_overture: list):
    """Mantém OSM como base e acrescenta apenas leads realmente novos."""
    combinados = list(leads_osm)
    indice_por_telefone = {}
    indice_por_identidade = {}

    for indice, lead in enumerate(combinados):
        for telefone in telefones_do_lead(lead):
            indice_por_telefone[telefone] = indice
        indice_por_identidade[_chave_nome_endereco(lead)] = indice

    duplicados = 0
    for lead in leads_overture:
        numeros = telefones_do_lead(lead)
        identidade = _chave_nome_endereco(lead)
        indice_existente = next(
            (indice_por_telefone[numero] for numero in numeros if numero in indice_por_telefone),
            indice_por_identidade.get(identidade),
        )

        if indice_existente is not None:
            duplicados += 1
            existente = combinados[indice_existente]
            fontes = [fonte.strip() for fonte in str(existente.get("Fonte") or "OpenStreetMap").split("+")]
            if "Overture Maps" not in fontes:
                existente["Fonte"] = " + ".join(fontes + ["Overture Maps"])
            if not existente.get("Confiança") and lead.get("Confiança"):
                existente["Confiança"] = lead["Confiança"]
            continue

        novo_indice = len(combinados)
        combinados.append(lead)
        for numero in numeros:
            indice_por_telefone[numero] = novo_indice
        indice_por_identidade[identidade] = novo_indice

    return combinados, duplicados


def coletar_leads_de_uma_cidade(cidade: str, categorias: dict, ao_atualizar_progresso=None,
                              estado=None, ao_salvar=None):
    """Coleta uma cidade e informa se todas as categorias terminaram."""
    configuracao_cidade = configuracao_da_cidade(cidade)
    print(f"\n{'='*70}\n🏙️  CIDADE: {cidade}\n{'='*70}")
    print(f"🔎 Localizando '{cidade}' no Nominatim...")
    try:
        bbox = obter_bounding_box(cidade)
    except (ValueError, requests.RequestException) as e:
        print(f"   ⚠️  Não foi possível localizar '{cidade}': {e}")
        return [], False, {"erro_localizacao": 1}

    print(f"   Bounding box encontrada: {bbox}")

    estado = estado if estado is not None else {}
    leads = list(estado.get("leads", []))
    categorias_concluidas = set(estado.get("categorias_concluidas", []))
    consultas_divididas = estado.setdefault("consultas_divididas", {})
    cidade_completa = True
    resumo_cidade = {
        "elementos": 0,
        "sem_nome": 0,
        "com_site": 0,
        "sem_telefone": 0,
        "leads_validos": 0,
        "categorias_com_erro": 0,
    }
    resumo_cidade.update(estado.get("resumo", {}))
    resumo_cidade["categorias_com_erro"] = 0

    total_categorias = len(categorias)
    for indice_categoria, (nome_categoria, alternativas_filtros) in enumerate(categorias.items(), start=1):
        verificar_parada_painel()
        if nome_categoria in categorias_concluidas:
            continue
        if ao_atualizar_progresso:
            ao_atualizar_progresso(
                cidade,
                nome_categoria,
                indice_categoria,
                total_categorias,
                "consultando",
                resumo_cidade,
            )
        descricao_filtros = descrever_alternativas_filtros(alternativas_filtros)
        print(f"\n📍 Buscando categoria: {nome_categoria} ({descricao_filtros})...")
        try:
            elementos = buscar_estabelecimentos(
                bbox, alternativas_filtros,
                estado=consultas_divididas.setdefault(nome_categoria, {}), ao_salvar=ao_salvar,
            )
        except requests.RequestException as e:
            print(f"   ⚠️  Erro ao consultar Overpass para '{nome_categoria}': {e}")
            cidade_completa = False
            resumo_cidade["categorias_com_erro"] += 1
            if isinstance(e, OverpassEmEspera):
                break
            continue

        print(f"   Total de estabelecimentos encontrados: {len(elementos)}")

        sem_site_count = 0
        sem_nome_count = 0
        com_site_count = 0
        sem_telefone_count = 0
        for el in elementos:
            tags = el.get("tags", {})
            nome = tags.get("name") or tags.get("brand") or tags.get("operator")

            if not nome:
                sem_nome_count += 1
                continue  # ignora estabelecimentos sem nome cadastrado

            if tem_site(tags):
                com_site_count += 1
                continue  # já tem site, não é lead

            telefone = obter_telefone(tags, configuracao_cidade)
            if telefone == "Não informado":
                sem_telefone_count += 1
                continue  # sem telefone cadastrado, não é lead válido

            leads.append({
                "Nome": nome,
                "Categoria": categoria_mais_especifica(nome_categoria, tags, nome),
                "Cidade": cidade,
                "Endereço": montar_endereco(tags),
                "Telefone": telefone,
                "Site cadastrado no OSM": "Sim" if tem_site(tags) else "Não",
                "Outro contato (WhatsApp/Instagram)": obter_outros_contatos(tags),
                "Fonte": "OpenStreetMap",
                "ID da fonte": f"{el.get('type', '')}/{el.get('id', '')}".strip("/"),
                "Confiança": "",
                "País": configuracao_cidade["pais"],
                "DDI": configuracao_cidade["ddi"],
                "Idioma": configuracao_cidade["idioma"],
            })
            sem_site_count += 1

        print(f"   Leads sem site E com telefone nesta categoria: {sem_site_count}")
        print(
            "   Descartados: "
            f"sem nome={sem_nome_count}, com site={com_site_count}, "
            f"sem telefone/WhatsApp válido={sem_telefone_count}"
        )

        resumo_cidade["elementos"] += len(elementos)
        resumo_cidade["sem_nome"] += sem_nome_count
        resumo_cidade["com_site"] += com_site_count
        resumo_cidade["sem_telefone"] += sem_telefone_count
        resumo_cidade["leads_validos"] += sem_site_count

        categorias_concluidas.add(nome_categoria)
        consultas_divididas.pop(nome_categoria, None)
        estado.update({"leads": leads, "categorias_concluidas": sorted(categorias_concluidas),
                       "resumo": resumo_cidade})
        if ao_salvar:
            ao_salvar()

        if ao_atualizar_progresso:
            ao_atualizar_progresso(
                cidade,
                nome_categoria,
                indice_categoria,
                total_categorias,
                "concluida",
                resumo_cidade,
            )

        # Mantém a pausa entre categorias e todas as consultas configuradas.
        esperar_interrompivel(PAUSA_ENTRE_CATEGORIAS_SEGUNDOS)

    return leads, cidade_completa and set(categorias).issubset(categorias_concluidas), resumo_cidade


def coletar_leads(cidades: list, categorias: dict):
    """Coleta leads (sem site) para uma LISTA de cidades e todas as categorias informadas."""
    todos_os_leads = []

    for i, cidade in enumerate(cidades):
        leads_da_cidade, _, _ = coletar_leads_de_uma_cidade(cidade, categorias)
        todos_os_leads.extend(leads_da_cidade)

        # Pausa maior entre cidades para não sobrecarregar Nominatim/Overpass
        if i < len(cidades) - 1:
            esperar_interrompivel(PAUSA_ENTRE_CIDADES_SEGUNDOS)

    return todos_os_leads


CAMPOS = [
    "Nome",
    "Categoria",
    "Cidade",
    "Endereço",
    "Telefone",
    "Site cadastrado no OSM",
    "Outro contato (WhatsApp/Instagram)",
    "Fonte",
    "ID da fonte",
    "Confiança",
    "País",
    "DDI",
    "Idioma",
]

NOME_ABA_COMBINADA = "Contatos"  # aba que enviar_mensagens_whatsapp.js vai ler


def carregar_leads_existentes(caminho_arquivo: str) -> list:
    return read_leads(caminho_arquivo, NOME_ABA_COMBINADA, verificar_parada_painel,
                      progress=lambda message: print(message, flush=True))


def salvar_excel(leads: list, caminho_arquivo: str):
    if not leads:
        print("Nenhum lead encontrado. A planilha existente foi preservada.", flush=True)
        return
    print(f"Exportando {len(leads)} contatos para a planilha...", flush=True)
    abas = write_leads(leads, caminho_arquivo, CAMPOS, NOME_ABA_COMBINADA,
                       progress=lambda message: print(message, flush=True))
    print(f"Arquivo salvo com sucesso: {caminho_arquivo}", flush=True)
    print(f"Total de leads no arquivo (antigos + novos): {len(leads)}", flush=True)
    print(f"Abas criadas: {', '.join(abas)}", flush=True)


def assinatura_da_configuracao() -> str:
    conteudo = json.dumps(
        {
            "cidades": CIDADES,
            "configuracao_cidades": CONFIGURACAO_CIDADES,
            "categorias": CATEGORIAS,
            "ativar_overture": ATIVAR_OVERTURE,
            "cidades_overture": sorted(CIDADES_OVERTURE),
            "confianca_minima_overture": CONFIANCA_MINIMA_OVERTURE,
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(conteudo.encode("utf-8")).hexdigest()


def carregar_progresso_busca(assinatura_atual: str) -> dict:
    progresso_padrao = {
        "assinatura": assinatura_atual,
        "cidades_concluidas": [],
        "leads_pendentes": [],
        "fontes_por_cidade": {},
    }
    try:
        progresso = checkpoint_busca().load()
    except FileNotFoundError:
        return progresso_padrao
    except (ValueError, OSError) as e:
        raise RuntimeError(
            "Não foi possível confirmar a leitura/recuperação do progresso. "
            "Os arquivos foram preservados; a busca não reiniciará do zero. "
            f"Detalhe: {e}"
        ) from e

    leads_pendentes = progresso.get("leads_pendentes", [])
    if not isinstance(leads_pendentes, list):
        leads_pendentes = []

    if progresso.get("assinatura") != assinatura_atual:
        print("ℹ️  A lista de cidades/categorias mudou; reiniciando a varredura completa.")
        return {
            **progresso_padrao,
            # Leads encontrados antes da mudança continuam válidos e serão
            # incorporados à planilha ao final desta execução.
            "leads_pendentes": leads_pendentes,
        }

    cidades_concluidas = progresso.get("cidades_concluidas", [])
    if not isinstance(cidades_concluidas, list):
        cidades_concluidas = []

    return {
        "assinatura": assinatura_atual,
        "cidades_concluidas": cidades_concluidas,
        "leads_pendentes": leads_pendentes,
        "fontes_por_cidade": progresso.get("fontes_por_cidade", {})
        if isinstance(progresso.get("fontes_por_cidade"), dict) else {},
    }


CHECKPOINT_BUSCA = None


def checkpoint_busca():
    global CHECKPOINT_BUSCA
    if CHECKPOINT_BUSCA is None or str(CHECKPOINT_BUSCA.path) != CAMINHO_PROGRESSO:
        CHECKPOINT_BUSCA = SearchCheckpoint(CAMINHO_PROGRESSO)
    return CHECKPOINT_BUSCA


def salvar_progresso_busca(progresso: dict, cidade=None, fonte=None):
    progresso["atualizado_em"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    checkpoint_busca().save(progresso, cidade, fonte)


def salvar_andamento_busca(andamento: dict):
    """Publica uma telemetria pequena para o painel sem alterar o checkpoint."""
    andamento["atualizado_em"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    salvar_json_atomico(CAMINHO_ANDAMENTO, andamento)


def limpar_progresso_busca():
    try:
        os.remove(CAMINHO_PROGRESSO)
    except FileNotFoundError:
        pass


# =========================================================================
# EXECUÇÃO
# =========================================================================

def coletar_fontes_prioritarias(cidade, categorias, estado, atualizar=None, salvar=None):
    """Overture primeiro; fontes concluídas ficam recuperáveis no checkpoint."""
    overture = estado.setdefault("overture", {})
    leads_overture, resumo_overture = [], {}
    overture_completo = True
    if ATIVAR_OVERTURE and cidade in CIDADES_OVERTURE:
        if not overture.get("concluida"):
            if atualizar:
                atualizar(cidade, "Localizando cidade", 0, len(categorias), "consultando", {})
            try:
                bbox = obter_bounding_box(cidade)
            except (ValueError, requests.RequestException):
                return [], False, {"erro_localizacao": 1}, [], {}
            if atualizar:
                atualizar(cidade, "Overture Maps", 0, len(categorias), "consultando", {})
            leads_overture, overture_completo, resumo_overture = consulta_interrompivel(coletar_leads_overture, cidade, bbox)
            overture.update({"concluida": overture_completo, "leads": leads_overture,
                             "resumo": resumo_overture})
            if salvar:
                salvar(cidade, "overture")
        else:
            print(f"♻️  Overture de {cidade} já concluído; retomando somente as consultas pendentes.")
            leads_overture = list(overture.get("leads", []))
            resumo_overture = dict(overture.get("resumo", {}))
    osm = estado.setdefault("osm", {})
    leads_osm, osm_completo, resumo_osm = coletar_leads_de_uma_cidade(
        cidade, categorias, atualizar, estado=osm,
        ao_salvar=(lambda: salvar(cidade, "osm")) if salvar else None,
    )
    return leads_osm, osm_completo and overture_completo, resumo_osm, leads_overture, resumo_overture


def executar_busca():
    from crm.account_authorization import authorize_search
    authorize_search()
    andamento_busca = None
    salvar_checkpoint = None
    try:
        verificar_parada_painel()
        if phonenumbers is None:
            raise RuntimeError(
                "O pacote phonenumbers não está instalado. Execute: pip install phonenumbers"
            )

        print("Lendo a planilha existente e conferindo o progresso salvo...", flush=True)
        assinatura_atual = assinatura_da_configuracao()
        progresso = carregar_progresso_busca(assinatura_atual)
        cidades_concluidas = set(progresso["cidades_concluidas"])
        leads_pendentes = list(progresso["leads_pendentes"])
        fontes_por_cidade = progresso.get("fontes_por_cidade", {})

        def salvar_checkpoint(cidade=None, fonte=None):
            salvar_progresso_busca({
                "assinatura": assinatura_atual,
                "cidades_concluidas": sorted(cidades_concluidas),
                "leads_pendentes": leads_pendentes,
                "fontes_por_cidade": fontes_por_cidade,
            }, cidade, fonte)

        def consultas_concluidas():
            return sum(len(CATEGORIAS) if cidade in cidades_concluidas else len(
                set(fontes_por_cidade.get(cidade, {}).get("osm", {}).get("categorias_concluidas", [])) & set(CATEGORIAS)
            ) for cidade in CIDADES)

        # Lê os dois históricos antes de iniciar. Se uma execução anterior
        # parou entre salvar o Excel e salvar o JSON, a união evita duplicatas.
        chaves_ja_exportadas = carregar_registro_de_leads(CAMINHO_REGISTRO)
        leads_existentes = carregar_leads_existentes(CAMINHO_SAIDA)
        verificar_parada_painel()
        total_leads_iniciais = len(leads_existentes)
        chaves_existentes_excel = {
            chave_unica_do_lead(lead) for lead in leads_existentes
        }
        chaves_confirmadas = chaves_ja_exportadas | chaves_existentes_excel
        telefones_confirmados = set()
        for indice_lead, lead in enumerate(leads_existentes):
            if indice_lead % 128 == 0:
                verificar_parada_painel()
            telefones_confirmados.update(telefones_do_lead(lead))
        for indice_chave, chave in enumerate(chaves_ja_exportadas):
            if indice_chave % 128 == 0:
                verificar_parada_painel()
            partes_chave = chave.rsplit("|", 2)
            cidade_registrada = partes_chave[-2] if len(partes_chave) >= 2 else ""
            telefone_registrado = partes_chave[-1]
            configuracao_registro = configuracao_da_cidade(cidade_registrada)
            telefones_confirmados.update(
                numero
                for numero in limpar_telefone(
                    telefone_registrado,
                    configuracao_registro["iso"],
                    configuracao_registro["ddi"],
                ).split("; ")
                if numero
            )

        # Remove do checkpoint qualquer lead que já tenha sido confirmado no
        # Excel antes de uma eventual interrupção.
        pendentes_filtrados = []
        chaves_pendentes = set()
        telefones_pendentes = set()
        for lead in leads_pendentes:
            chave = chave_unica_do_lead(lead)
            numeros = telefones_do_lead(lead)
            if (
                chave in chaves_confirmadas
                or chave in chaves_pendentes
                or bool(numeros & telefones_confirmados)
                or bool(numeros & telefones_pendentes)
            ):
                continue
            pendentes_filtrados.append(lead)
            chaves_pendentes.add(chave)
            telefones_pendentes.update(numeros)
        leads_pendentes = pendentes_filtrados
        chaves_conhecidas = chaves_confirmadas | chaves_pendentes
        telefones_conhecidos = telefones_confirmados | telefones_pendentes

        print(f"\n🔎 Consultas mantidas: {len(CIDADES)} cidades x {len(CATEGORIAS)} categorias = {len(CIDADES) * len(CATEGORIAS)} buscas.")
        mercados_ativos = sorted({dados["pais"] for dados in CONFIGURACAO_CIDADES.values()})
        print(f"🌍 Mercados ativos: {', '.join(mercados_ativos)}")
        if ATIVAR_OVERTURE:
            print(
                f"🌐 Overture Maps ativo como fonte complementar em todas as {len(CIDADES_OVERTURE)} cidades da busca."
            )
        if cidades_concluidas:
            print(f"♻️  Retomando progresso: {len(cidades_concluidas)} cidade(s) já concluída(s) serão puladas.")

        total_encontrados = 0
        total_repetidos = 0
        total_novos_execucao = 0
        total_osm_validos = 0
        total_overture_validos = 0
        total_duplicados_entre_fontes = 0
        contribuicoes_por_cidade = {}
        leads_analisados_execucao = set()
        resumo_geral = {
            "elementos": 0,
            "sem_nome": 0,
            "com_site": 0,
            "sem_telefone": 0,
            "leads_validos": 0,
            "categorias_com_erro": 0,
        }
        resumo_overture_geral = {
            "elementos": 0,
            "fora_das_categorias": 0,
            "baixa_confianca": 0,
            "fechados": 0,
            "sem_nome": 0,
            "com_site": 0,
            "sem_telefone": 0,
            "leads_validos": 0,
        }

        total_cidades = len(CIDADES)
        total_categorias = len(CATEGORIAS)
        total_consultas = total_cidades * total_categorias
        andamento_busca = {
            "status": "em_execucao",
            "iniciada_em": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "total_cidades": total_cidades,
            "cidades_concluidas_quantidade": len(cidades_concluidas),
            "cidades_faltantes": max(0, total_cidades - len(cidades_concluidas)),
            "cidade_atual": "",
            "ultima_cidade": "",
            "categoria_atual": "",
            "categoria_indice": 0,
            "total_categorias": total_categorias,
            "consultas_processadas": consultas_concluidas(),
            "total_consultas": total_consultas,
            "novos_leads": 0,
            "encontrados": 0,
            "total_leads": len(leads_existentes) + len(leads_pendentes),
            "leads_validos_cidade": 0,
        }
        salvar_andamento_busca(andamento_busca)

        def atualizar_categoria(cidade_atual, categoria_atual, indice_categoria,
                                quantidade_categorias, fase, resumo_cidade):
            andamento_busca.update({
                "status": "em_execucao",
                "cidade_atual": cidade_atual,
                "categoria_atual": categoria_atual,
                "categoria_indice": indice_categoria,
                "total_categorias": quantidade_categorias,
                "consultas_processadas": consultas_concluidas(),
                "leads_validos_cidade": resumo_cidade.get("leads_validos", 0),
            })
            salvar_andamento_busca(andamento_busca)

        def esperar_retomada(segundos):
            aguardar_controle_painel(andamento_busca)
            andamento_busca["categoria_atual"] = f"Aguardando {segundos}s para retomar consultas pendentes"
            salvar_andamento_busca(andamento_busca)
            esperar_interrompivel(segundos)
            aguardar_controle_painel(andamento_busca)

        for indice, cidade in retry_cities(CIDADES, cidades_concluidas, esperar_retomada, ESPERAS_RETOMADA):
            aguardar_controle_painel(andamento_busca)
            if cidade in cidades_concluidas:
                continue

            andamento_busca.update({
                "status": "em_execucao",
                "cidade_atual": cidade,
                "categoria_atual": "Overture primeiro; OSM em seguida",
                "categoria_indice": 0,
                "leads_validos_cidade": 0,
            })
            salvar_andamento_busca(andamento_busca)

            leads_osm, cidade_completa, resumo_cidade, leads_overture, resumo_overture = coletar_fontes_prioritarias(
                cidade, CATEGORIAS, fontes_por_cidade.setdefault(cidade, {}),
                atualizar_categoria, salvar_checkpoint,
            )
            anterior = contribuicoes_por_cidade.get(cidade, {})
            total_osm_validos += len(leads_osm) - anterior.get("osm", 0)
            for campo in resumo_geral:
                resumo_geral[campo] += resumo_cidade.get(campo, 0) - anterior.get("resumo_osm", {}).get(campo, 0)

            total_overture_validos += len(leads_overture) - anterior.get("overture", 0)
            for campo in resumo_overture_geral:
                resumo_overture_geral[campo] += resumo_overture.get(campo, 0) - anterior.get("resumo_overture", {}).get(campo, 0)

            leads_da_cidade, duplicados_fontes = mesclar_leads_das_fontes(
                leads_osm,
                leads_overture,
            )
            total_duplicados_entre_fontes += duplicados_fontes - anterior.get("duplicados", 0)
            total_encontrados += len(leads_da_cidade) - anterior.get("encontrados", 0)
            contribuicoes_por_cidade[cidade] = {
                "osm": len(leads_osm), "overture": len(leads_overture),
                "duplicados": duplicados_fontes, "encontrados": len(leads_da_cidade),
                "resumo_osm": dict(resumo_cidade), "resumo_overture": dict(resumo_overture),
            }
            if leads_overture:
                print(
                    f"   Comparação das fontes: OSM={len(leads_osm)}, "
                    f"Overture={len(leads_overture)}, repetidos entre fontes={duplicados_fontes}, "
                    f"total combinado={len(leads_da_cidade)}"
                )

            for lead in leads_da_cidade:
                chave = chave_unica_do_lead(lead)
                identidade_execucao = (cidade, chave)
                if identidade_execucao in leads_analisados_execucao:
                    continue
                leads_analisados_execucao.add(identidade_execucao)
                numeros = telefones_do_lead(lead)
                if chave in chaves_conhecidas or bool(numeros & telefones_conhecidos):
                    total_repetidos += 1
                    continue
                leads_pendentes.append(lead)
                chaves_conhecidas.add(chave)
                telefones_conhecidos.update(numeros)
                total_novos_execucao += 1

            if cidade_completa:
                cidades_concluidas.add(cidade)
                print(f"✅ Cidade concluída e registrada no progresso: {cidade}")
            else:
                print(f"⚠️  {cidade} ficou pendente porque uma ou mais categorias falharam.")

            progresso = {
                "assinatura": assinatura_atual,
                "cidades_concluidas": sorted(cidades_concluidas),
                "leads_pendentes": leads_pendentes,
                "fontes_por_cidade": fontes_por_cidade,
            }
            salvar_progresso_busca(progresso)
            # A cidade coletada já pode ser usada sem esperar toda a execução.
            if leads_pendentes:
                leads_existentes = leads_existentes + leads_pendentes
                salvar_excel(leads_existentes, CAMINHO_SAIDA)
                salvar_registro_de_leads(CAMINHO_REGISTRO, chaves_conhecidas)
                leads_pendentes = []
                salvar_checkpoint()
            andamento_busca.update({
                "cidades_concluidas_quantidade": len(cidades_concluidas),
                "cidades_faltantes": max(0, total_cidades - len(cidades_concluidas)),
                "ultima_cidade": cidade,
                "consultas_processadas": consultas_concluidas(),
                "novos_leads": total_novos_execucao,
                "encontrados": total_encontrados,
                "total_leads": len(leads_existentes) + len(leads_pendentes),
                "leads_validos_cidade": resumo_cidade.get("leads_validos", 0),
            })
            salvar_andamento_busca(andamento_busca)

            aguardar_controle_painel(andamento_busca)
            if indice < len(CIDADES) - 1:
                esperar_interrompivel(PAUSA_ENTRE_CIDADES_SEGUNDOS)

        print(f"\n{'='*70}")
        print(f"📊 RESUMO GERAL")
        print(f"{'='*70}")
        print(f"   Elementos retornados pelo OSM: {resumo_geral['elementos']}")
        print(f"   Descartados sem nome: {resumo_geral['sem_nome']}")
        print(f"   Descartados por já terem site: {resumo_geral['com_site']}")
        print(f"   Descartados sem telefone/WhatsApp válido: {resumo_geral['sem_telefone']}")
        print(f"   Leads válidos do OSM nesta execução: {total_osm_validos}")
        print(f"   Leads válidos do Overture nesta execução: {total_overture_validos}")
        print(f"   Repetidos entre OSM e Overture: {total_duplicados_entre_fontes}")
        print(f"   Leads combinados após comparar as fontes: {total_encontrados}")
        print(f"   Já capturados ou repetidos (ignorados): {total_repetidos}")
        print(f"   Leads NOVOS nesta execução: {total_novos_execucao}")
        print(f"   Leads que já estavam em {ARQUIVO_SAIDA}: {total_leads_iniciais}")

        total_leads_apos_execucao = len(leads_existentes) + len(leads_pendentes)
        if leads_pendentes:
            leads_combinados = leads_existentes + leads_pendentes
            salvar_excel(leads_combinados, CAMINHO_SAIDA)
            salvar_registro_de_leads(CAMINHO_REGISTRO, chaves_conhecidas)
            print(f"\n📝 Registro de leads atualizado: {ARQUIVO_REGISTRO}")
            leads_pendentes = []
        else:
            if total_novos_execucao:
                print(f"\n📝 {total_novos_execucao} leads novos já exportados durante a busca em {ARQUIVO_SAIDA}.")
            else:
                print(f"\n⚠️  Nenhum lead novo encontrado. {ARQUIVO_SAIDA} não foi alterado.")
            if chaves_conhecidas != chaves_ja_exportadas:
                salvar_registro_de_leads(CAMINHO_REGISTRO, chaves_conhecidas)
                print(f"📝 Registro sincronizado com os leads existentes em {ARQUIVO_SAIDA}.")

        cidades_pendentes = [cidade for cidade in CIDADES if cidade not in cidades_concluidas]
        if cidades_pendentes:
            salvar_progresso_busca({
                "assinatura": assinatura_atual,
                "cidades_concluidas": sorted(cidades_concluidas),
                "leads_pendentes": leads_pendentes,
                "fontes_por_cidade": fontes_por_cidade,
            })
            print("\n⚠️  A busca terminou parcialmente. Na próxima execução, somente estas cidades serão retomadas:")
            for cidade in cidades_pendentes:
                print(f"   - {cidade}")
            andamento_busca.update({
                "status": "parcial",
                "cidade_atual": "",
                "categoria_atual": "",
                "cidades_concluidas_quantidade": len(cidades_concluidas),
                "cidades_faltantes": len(cidades_pendentes),
                "novos_leads": total_novos_execucao,
                "encontrados": total_encontrados,
                "total_leads": total_leads_apos_execucao,
            })
            salvar_andamento_busca(andamento_busca)
            # Resultado parcial salvo não é uma falha fatal. Marcador + código
            # dedicado permitem ao painel distinguir esse caso de um crash.
            print("[[PLOA_SEARCH_PARTIAL]]", flush=True)
            sys.exit(2)

        limpar_progresso_busca()
        andamento_busca.update({
            "status": "concluida",
            "cidade_atual": "",
            "categoria_atual": "",
            "categoria_indice": total_categorias,
            "cidades_concluidas_quantidade": total_cidades,
            "cidades_faltantes": 0,
            "consultas_processadas": total_consultas,
            "novos_leads": total_novos_execucao,
            "encontrados": total_encontrados,
            "total_leads": total_leads_apos_execucao,
        })
        salvar_andamento_busca(andamento_busca)
        print("\n✅ Todas as cidades e categorias foram concluídas.")

    except ParadaBusca:
        if salvar_checkpoint is not None:
            salvar_checkpoint()
        if andamento_busca is not None:
            andamento_busca["status"] = "interrompida"
            salvar_andamento_busca(andamento_busca)
        print("Parada concluída. Consultas concluídas preservadas; a consulta interrompida será retomada no próximo início.", flush=True)
        raise SystemExit(0)
    except Exception as e:
        if andamento_busca is not None:
            andamento_busca.update({
                "status": "erro",
                "erro": str(e),
            })
            try:
                salvar_andamento_busca(andamento_busca)
            except OSError:
                pass
        print(f"\n❌ Erro durante a execução: {e}")
        sys.exit(1)


if __name__ == "__main__":
    executar_busca()
