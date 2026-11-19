# Ploa

Plataforma desktop de operação e vendas com busca de leads, integração com WhatsApp, atendimento com IA e gestão do funil comercial. Contas e configurações individuais por negócio.

## Estrutura

- `crm/desktop-accounts.js`: entrada Electron com contas.
- `crm/server.js` e `crm/lib/`: painel local e serviços comerciais.
- `crm/app-next/src/`: interface React/Vite e telas de acesso.
- `crm/cloud/`: serviço de contas, sessões, permissões e envio de códigos por e-mail.
- `crm/cloud/schema/`: migrações e verificações SQL versionadas.
- `buscar_leads.py`: coleta e exportação de leads.
- `enviar_mensagens_whatsapp.js`: integração com WhatsApp, fila e acompanhamento.
- `crm/test/`: testes com dados e serviços fictícios.

## Preparação para desenvolvimento

Requer Node.js 24, npm, Python 3.12 e Chrome ou Edge para a integração com WhatsApp. FFmpeg, FFprobe, Tesseract e modelos de idioma são recursos opcionais para processamento de criativos e precisam ser provisionados separadamente.

```powershell
npm ci
npm --prefix crm/app-next ci
python -m pip install -r requirements.txt
npm run crm:next:build
npm run crm:cloud:build
```

O código não inclui node_modules, Python portátil, instalador ou builds gerados. As ferramentas de preparação Windows ficam em `crm/tools/`.

## Contas e configuração

Copie `crm/cloud/.env.example` para `crm/cloud/.env` e configure somente no seu ambiente as URLs e chaves necessárias. Use `crm/cloud/.env.production.example` como referência para o serviço hospedado. Credenciais administrativas pertencem exclusivamente ao serviço de contas e nunca ao React ou ao instalador distribuído.

A implantação existente usa projeto Supabase próprio e Cloudflare Workers. Identificadores de projeto presentes na fonte não são chaves de acesso; uma implantação independente precisa de configuração própria e migrações conferidas antes de aplicar. Google OAuth, remetente SMTP e permissões de conta também exigem configuração externa.

```powershell
npm run crm:app:accounts
```

A entrada com contas precisa do serviço de acesso configurado. Para desenvolvimento isolado do painel legado em loopback, existe `npm run crm` (porta 4310); essa entrada não substitui a autenticação da distribuição com contas. Não exponha essa porta na rede.

As operações de busca, conexão e envio devem ser iniciadas explicitamente no painel, depois de configurar a conta. Clonar este repositório não importa a base comercial de outra instalação.

## Testes

```powershell
node --test --test-concurrency=1 crm/test/*.test.js
```

Para incluir os testes Python de busca, defina `CRM_TEST_PYTHON` com o caminho do Python que tenha as dependências instaladas. As fixtures usam pastas temporárias e fontes simuladas; não precisam de contatos reais nem de conexão ao WhatsApp.

## Dados privados

Este repositório contém código, testes, ativos visuais e exemplos de configuração. Não contém contatos, conversas, copys salvas na operação, histórico de envios, sessões do WhatsApp, chaves de API, arquivos .env reais ou backups. O .gitignore protege esses arquivos nas cópias locais. Credenciais e dados operacionais continuam na instalação de cada usuário.

## Estado de desenvolvimento

Fonte publicada com whatsapp-web.js fixado em **1.34.7** e compatibilidade do ciclo de navegação ajustada. O retorno de versão não comprova resolução dos logouts ou de restrições do WhatsApp. Há pendências conhecidas de tratamento de URLs HTTP inválidas e conciliação do status histórico do Dashboard. O catálogo de anúncios depende de acesso à API da Meta.

Este envio versiona a fonte; não publica o painel na internet, não cria um instalador e não inicia scripts comerciais.
