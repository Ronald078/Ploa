"""Runs the real search orchestrator in a disposable root with simulated sources."""
import importlib.util
import json
import os
import sys
import time
from pathlib import Path

project = Path(os.environ["PLOA_SEARCH_TEST_PROJECT"])
sys.path.insert(0, str(project))
root = Path.cwd()
# runtime_paths resolves this on every control check, including before the
# orchestrator globals are redirected below. Never read the operator's root.
os.environ["PLOA_DATA_ROOT"] = str(root)
spec = importlib.util.spec_from_file_location("search_under_test", project / "buscar_leads.py")
search = importlib.util.module_from_spec(spec)
spec.loader.exec_module(search)
# All writes, including panel control, are redirected before execution.
search.__file__ = str(root / "buscar_leads.py")
search.PASTA_DO_SCRIPT = str(root)
for name in ("REGISTRO", "SAIDA", "CACHE_CIDADES", "PROGRESSO", "ANDAMENTO"):
    setattr(search, "CAMINHO_" + name, str(root / getattr(search, "ARQUIVO_" + name)))
city = "Cidade de teste, Brasil"
search.CIDADES = [city]
search.CONFIGURACAO_CIDADES = {city: {"pais": "Brasil", "iso": "BR", "ddi": "55", "idioma": "pt-BR"}}
search.CIDADES_OVERTURE = {city}
search.CATEGORIAS = {"Restaurante": [[("amenity", "restaurant")]], "Petshop": [[("shop", "pet")]]}
search.PAUSA_ENTRE_CATEGORIAS_SEGUNDOS = 0
search.PAUSA_ENTRE_CIDADES_SEGUNDOS = 0
search.ESPERAS_RETOMADA = (0, 0)
original_bbox = search.obter_bounding_box
search.obter_bounding_box = lambda _: (-12.98, -38.52, -12.97, -38.51)
calls_file = root / "source-calls.json"
calls = json.loads(calls_file.read_text()) if calls_file.exists() else {"overture": 0, "restaurant": 0, "pet": 0}

def counted(key):
    calls[key] += 1
    calls_file.write_text(json.dumps(calls))

def osm(_bbox, filters, **kwargs):
    key = "restaurant" if filters[0][0][1] == "restaurant" else "pet"
    counted(key)
    if key == "pet" and calls[key] == 1 and os.environ.get("PLOA_SEARCH_TEST_CASE") == "partial":
        raise search.requests.ConnectionError("Falha simulada de fonte")
    if key == "pet" and calls[key] <= 3 and os.environ.get("PLOA_SEARCH_TEST_CASE") == "persistent-partial":
        raise search.requests.ConnectionError("Falha persistente simulada de fonte")
    return [{"type": "node", "id": key, "tags": {"name": "Fictício " + key,
             "phone": "+55 11 99999-" + ("1234" if key == "restaurant" else "5678")}}]

def overture(_city, _bbox):
    counted("overture")
    return [{"Nome": "Outra empresa fictícia", "Telefone": "5511988881234", "Categoria": "Restaurante",
             "Cidade": city, "País": "Brasil", "DDI": "55", "Idioma": "pt-BR", "Fonte": "Overture Maps"}], True, {}

original_osm = search.buscar_estabelecimentos
search.buscar_estabelecimentos = osm
search.coletar_leads_overture = overture
scenario = os.environ.get("PLOA_SEARCH_TEST_CASE")

def blocked(*args, **kwargs):
    (root / "waiting-for-source").touch()
    time.sleep(60)  # No real provider request; the panel must stop without waiting.
    raise RuntimeError("A consulta simulada não deveria concluir")

if scenario == "stop-overture":
    search.coletar_leads_overture = blocked
elif scenario == "stop-nominatim":
    search.obter_bounding_box = original_bbox
    search.SESSAO_HTTP.get = blocked
elif scenario == "stop-overpass":
    search.SESSAO_HTTP.post = blocked
    def interruptible_osm(bbox, filters, **kwargs):
        if filters[0][0][1] == "restaurant":
            return osm(bbox, filters)
        return original_osm(bbox, filters, **kwargs)
    search.buscar_estabelecimentos = interruptible_osm
elif scenario == "stop-wait":
    original_wait = search.esperar_interrompivel
    def long_wait(_):
        (root / "waiting-for-source").touch()
        original_wait(60)
    search.esperar_interrompivel = long_wait

if os.environ.get("PLOA_SEARCH_TEST_CASE") == "export-failure" and not (root / "export-failed").exists():
    def blocked_export(*_):
        (root / "export-failed").touch()
        raise PermissionError("Planilha aberta: falha simulada")
    search.salvar_excel = blocked_export
search.executar_busca()
