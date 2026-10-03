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

- **Helmet & Rate Limiting**: Proteção com headers de segurança HTTP e limite de 100 requisições a cada 15 minutos por IP.
- **Validação com Zod**: Schemas estritos para validação de formato e limites de perguntas (`QuestionSchema`, `CreateRoomSchema`).
- **UUIDs Públicos**: Cada jogador recebe um UUID v4 criptográfico, mantendo os `socket.id` protegidos internamente.
- **Auto-Rejoin & Grace Period**:
  - Jogadores têm tolerância de 25 segundos ao desconectar (refresh / oscilação de conexão).
  - O reingresso com o `playerId` restaura a pontuação acumulada e sincroniza o estado atual da partida.
- **Limpeza Periódica**: Salas finalizadas ou inativas por mais de 1 hora são automaticamente desalocadas da memória.

---

## 📡 Endpoints HTTP

- `GET /health`: Verificação de status do servidor (`{ status: "online", timestamp: "..." }`).
- `GET /rooms`: Listagem do resumo das salas ativas e status dos lobbies.
