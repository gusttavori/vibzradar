# RADAR VIBZ

### Sistema de Inteligência e Monitoramento de Oportunidades do Instagram para o Vibz Eventos

O **Radar Vibz** é uma ferramenta interna de inteligência comercial e prospecção do Vibz Eventos (com atuação inicial em Vitória da Conquista e região Sudoeste da Bahia).

Seu objetivo é monitorar perfis de bares, casas de eventos, produtoras de festas, promotores, artistas e divulgadores, identificando automaticamente novos eventos por meio de inteligência artificial e convertendo essas informações em oportunidades comerciais no funil de vendas do Vibz.

---

## 🚀 Arquitetura do Sistema

O projeto é dividido em módulos independentes:

1. **Dashboard Executivo:** 8 KPIs em tempo real, monitoramento de saúde do motor, distribuição geográfica (Conquista, Jequié, Itabuna, Poções) e análise por categorias.
2. **Perfis Monitorados:** Cadastro, edição, status de monitoramento (ativo, pausado, falha), importação em lote por CSV e drawer com histórico completo.
3. **Descoberta de Perfis:** Prospecção regional e qualificação de estabelecimentos com aprovação direta para a lista de monitorados.
4. **Motor de Monitoramento & Agendador Automático (`node-cron`):**
   - Agendamento autônomo baseado no intervalo configurado no banco JSON (`30m`, `60m`, `3h`, `6h`).
   - Trava de concorrência em memória (`isMonitoring`) que impede execuções sobrepostas ou gargalos de API, liberada confiavelmente em bloco `finally`.
   - Provedor oficial via `MetaInstagramProvider` (Meta Graph API / Business Discovery) e contingência com `DemoSimulationProvider`. Sem scraping, roubo de cookies ou invasão de senhas.
   - Deduplicação persistente de notificações gravada no `radar_db.json`, impedindo reenvios após reinício da aplicação.
5. **Publicações:** Rastreamento de mídias, unicidade por `external_id` (Instagram Media ID), categorização e filtros.
6. **Inteligência Artificial (Google Gemini):** Análise semântica com o modelo `gemini-3.8-flash` via `@google/genai` gerando JSON validado, distinguindo rigorosamente data de postagem de data do evento.
7. **Oportunidades (CRM de Prospecção):** Pipeline Kanban com status comerciais (Nova, Em análise, Contato necessário, Em negociação, Convertida, Descartada) e registro de contatos (WhatsApp, Direct, Telefone, Presencial).
8. **Notificações Telegram:** Bot oficial do Telegram disparando cards editoriais padronizados para o grupo comercial.
9. **Configurações & Diagnóstico:** Gerenciamento de credenciais, testes de conexão em tempo real, restauração e limpeza de dados fictícios.
10. **Auditoria & Logs:** Histórico completo de auditoria por módulo com timestamps e latências.

---

## 🛠️ Stack Tecnológica

- **Frontend:** React, Vite, Lucide React, Tailwind CSS design system com paleta Vibz (`#4C01B5`, preto e neutros escuros).
- **Backend (Node.js/Express na prévia & Python FastAPI em repositório):**
  - Servidor Express em `server.ts` servindo `/api/*` e orquestrando o app em tempo real.
  - Repositório completo Python FastAPI em `/backend/` com SQLAlchemy, Pydantic, Alembic e PostgreSQL.
- **Banco de Dados:** Engine persistente com chaveamento atômico em JSON/SQLite e suporte nativo a PostgreSQL via Docker Compose.
- **Inteligência Artificial:** Google Gemini API (`@google/genai` com `gemini-3.8-flash`).
- **Notificações:** Telegram Bot API (`https://api.telegram.org`).

---

## 📦 Como Executar Localmente no Windows

### Pré-requisitos

- Node.js v18+ (recomendado v22.x LTS).
- NPM v10+ (já incluso com o Node.js).
- Windows PowerShell ou prompt de comando.

### Passo a Passo

```powershell
# 1. Clonar ou navegar até a pasta do projeto
cd g:\Projetos\radarvibz-main

# 2. Criar arquivo de configuração local a partir do exemplo
Copy-Item .env.example .env

# 3. Instalar dependências
npm install

# 4. Executar os testes automatizados
npm test

# 5. Iniciar o servidor de desenvolvimento (Node.js + Vite)
npm run dev
```

Após iniciar, acesse o painel no navegador:
👉 **http://localhost:3000** (ou `http://127.0.0.1:3000`)

---

## 🔑 Configuração de Variáveis de Ambiente & APIs Externas

O Radar Vibz foi concebido com **resiliência operacional total**: o sistema é 100% funcional no **modo de demonstração** mesmo que nenhuma credencial externa seja informada.

Para ativar os serviços em ambiente real, preencha as variáveis no arquivo `.env` ou configure diretamente pela aba **Configurações** na interface:

### 1. Google Gemini AI (`GEMINI_API_KEY`)

- **Finalidade:** Análise semântica profunda de legendas, identificação de eventos futuros, extração de artistas, data/horário e cálculo de oportunidade comercial para o Vibz.
- **Como obter:**
  1. Acesse o [Google AI Studio](https://aistudio.google.com/app/apikey).
  2. Clique em **Create API Key** em um projeto Google Cloud.
  3. Copie a chave gerada e atribua à variável:
     ```env
     GEMINI_API_KEY="AIzaSy..."
     ```
- **Modo Demonstração / Fallback:** Caso a chave não esteja configurada ou a quota seja excedida, o sistema aciona de forma transparente o **motor heurístico de regras**, garantindo classificação contínua de eventos sem interromper o fluxo operacional.

### 2. Meta Instagram Graph API (`META_ACCESS_TOKEN` e `META_PAGE_ID`)

- **Finalidade:** Consulta oficial e periódica a perfis comerciais e de criadores no Instagram através da funcionalidade oficial _Business Discovery_ da Meta (respeitando integralmente as diretrizes de privacidade e termos da plataforma).
- **Como obter:**
  1. Acesse o portal [Meta for Developers](https://developers.facebook.com) e crie um aplicativo corporativo do tipo **Business**.
  2. Adicione os produtos **Instagram Graph API** e **Facebook Login for Business**.
  3. Vincule a Página do Facebook que possui vínculo confirmado com sua conta profissional do Instagram.
  4. Localize o **ID da Página** nas configurações da página no Facebook e atribua a:
     ```env
     META_PAGE_ID="123456789012345"
     ```
  5. Gere um **Token de Acesso do Usuário do Sistema** (ou token de longa duração) no Meta Business Suite com os escopos:
     - `instagram_basic`
     - `pages_show_list`
     - `pages_read_engagement`
  6. Atribua o token gerado a:
     ```env
     META_ACCESS_TOKEN="EAA..."
     ```
- **Modo Demonstração / Fallback:** Se não configuradas, o provedor ativo mantém-se como `demo_simulation`, gerando publicações simuladas contextualizadas com estabelecimentos e eventos do Sudoeste Baiano.

### 3. Telegram Bot API (`TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`)

- **Finalidade:** Disparo em tempo real de cards editoriais padronizados para o canal ou grupo comercial da equipe do Vibz Eventos sempre que uma oportunidade de alta relevância é detectada.
- **Como obter:**
  1. No aplicativo do Telegram, inicie uma conversa com [@BotFather](https://t.me/botfather).
  2. Envie `/newbot` e siga as instruções para definir o nome e o username do seu bot.
  3. O BotFather fornecerá o token de acesso HTTP:
     ```env
     TELEGRAM_BOT_TOKEN="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
     ```
  4. Crie um grupo ou canal para o comercial do Vibz e adicione o bot recém-criado como administrador (com permissão para postar mensagens).
  5. Obtenha o identificador numérico do grupo (`TELEGRAM_CHAT_ID`). Você pode enviar uma mensagem no grupo e consultar `https://api.telegram.org/bot<SEU_TOKEN>/getUpdates` ou adicionar temporariamente o bot auxiliar `@userinfobot`.
  6. Atribua o ID à variável (atenção: IDs de supergrupos/canais iniciam com `-100`):
     ```env
     TELEGRAM_CHAT_ID="-1001234567890"
     ```
- **Modo Demonstração / Fallback:** Se não configurados, o serviço opera em modo simulado (`simulated: true`), registrando a formatação exata da mensagem nos registros de auditoria do sistema sem disparar erros.

---

## 🧪 Testes Unitários

Para rodar a suíte de testes de deduplicação, análise de IA e formatação:

```bash
npx --yes tsx --test src/services/tests/radar.test.ts
```

---

## 📋 Relatório de Funcionalidades & Limitações

### Implementado:

✅ Todos os 9 módulos funcionais com navegação fluida.
✅ 12 estabelecimentos demonstrativos fictícios no Sudoeste Baiano devidamente rotulados com `[DEMO]`.
✅ Deduplicação garantida por nome de usuário e `external_id` de publicação.
✅ CRM com Kanban, timeline de interações e registro de contatos.
✅ Varredura imediata e agendamento configurável (30m, 60m, 3h).
✅ Importação em massa de perfis por CSV com detecção de duplicidades.
✅ Testes unitários com `node:test` passando com 100% de sucesso.

### Limitações Conhecidas da API da Meta:

- Contas privadas ou perfis pessoais do Instagram não podem ser consultados pela Meta Graph API oficial (apenas contas Business e Creator públicas via Business Discovery). O Radar Vibz identifica perfis indisponíveis e os marca com status `Falha` para revisão humana.
