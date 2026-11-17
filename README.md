# Quiz Show - Servidor API

Backend em Node.js com Express e Socket.IO responsável pela gestão de partidas, salas e pontuação multiplayer em tempo real do [Quiz Show](https://github.com/Projeto-Hanna/Quiz-show-electron).

---

## 🚀 Requisitos

- **Node.js**: v20+ (recomendado v22+)
- **npm**, **yarn** ou gerenciador de pacotes equivalente

---

## 🛠️ Instalação

Clone o repositório e instale as dependências:

```bash
yarn install
```

---

## ⚙️ Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto (opcional em ambiente local):

```env
# Porta do servidor HTTP e WebSocket (Padrão: 3001)
PORT=3001

# Origens permitidas para CORS
# Em desenvolvimento, o padrão é '*' caso omitido.
# Em produção, informe uma URL ou múltiplos domínios separados por vírgula:
CORS_ORIGIN=http://localhost:5173,https://quiz-show.app

# Quantidade de proxies reversos entre o cliente e o servidor (Padrão: 1)
# 1     -> Render, Railway, Heroku, Fly.io ou Nginx/Caddy em uma VPS
# 2     -> CDN na frente da hospedagem (ex: Cloudflare + Render)
# false -> servidor exposto diretamente, sem proxy (ignora X-Forwarded-For)
TRUST_PROXY=1
```

---

## 📜 Scripts Disponíveis

| Comando             | Descrição                                                                   |
| ------------------- | --------------------------------------------------------------------------- |
| `yarn dev`          | Inicia o servidor em modo de desenvolvimento com hot-reload via `tsx watch` |
| `yarn build`        | Compila o código TypeScript para JavaScript na pasta `/dist`                |
| `yarn start`        | Inicia a aplicação compilada em produção (`node dist/index.js`)             |
| `yarn typecheck`    | Executa a checagem de tipos estática sem gerar saída (`tsc --noEmit`)       |
| `yarn lint`         | Executa o ESLint em todos os arquivos                                       |
| `yarn lint:fix`     | Corrige problemas automáticos apontados pelo linter                         |
| `yarn format`       | Formata o código com o Prettier                                             |
| `yarn format:check` | Verifica se o código atende às regras de formatação                         |

---

## 🛡️ Segurança & Funcionalidades

- **Helmet & Rate Limiting**: Proteção com headers de segurança HTTP e limite de 1500 requisições HTTP a cada 15 minutos por IP (a rota `/health` não é contabilizada). Cada conexão WebSocket também é limitada a 30 eventos por segundo.
- **Validação com Zod**: Schemas estritos para validação de formato, limites de perguntas e de todos os eventos Socket.IO (`QuestionSchema`, `CreateRoomSchema`, entre outros).
- **Limite de Participantes**: Até 150 jogadores por sala (configurável pelo Host na criação; padrão 10).
- **UUIDs Públicos**: Cada jogador recebe um UUID v4 criptográfico, mantendo os `socket.id` protegidos internamente.
- **Auto-Rejoin & Grace Period**:
  - No lobby, jogadores têm tolerância de 60 segundos ao desconectar (refresh / oscilação de conexão) antes de serem removidos.
  - Durante a partida, jogadores desconectados permanecem na sala (marcados como desconectados) e podem voltar a qualquer momento.
  - O Host tem tolerância de 3 minutos para reconectar antes de a sala ser encerrada.
  - O reingresso com o `playerToken` restaura a pontuação acumulada e sincroniza o estado atual da partida, incluindo o tempo restante calculado pelo servidor.
- **Limpeza Periódica**: Salas finalizadas ou inativas por mais de 1 hora são automaticamente desalocadas da memória.

---

## 📡 Endpoints HTTP

- `GET /health`: Verificação de status do servidor (`{ status: "online", timestamp: "..." }`).
- `GET /rooms`: Listagem do resumo das salas ativas e status dos lobbies.
