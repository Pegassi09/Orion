# Deploy na Vercel

1. Importe o repositório na Vercel ou execute `vercel` na raiz do projeto.
2. Em **Settings → Environment Variables**, defina `SESSION_SECRET`, `ENCRYPTION_KEY` e, opcionalmente, `COMPANY_NAME`.
3. Faça o deploy. A Vercel define `VERCEL=1` e encaminha todas as rotas para `server.js`.

## Persistência de dados

SQLite não é persistente na Vercel: a única área gravável de uma Function é `/tmp`, que pode ser descartada a qualquer momento. Por isso, nesta plataforma o arquivo `inventory.db`, uploads e backups são temporários. Não use este modo para dados de produção que precisem sobreviver a reinicializações.

Para produção, migre as tabelas SQLite para um banco externo persistente (por exemplo, Vercel Postgres, Neon ou Turso) e configure a aplicação para esse banco. Os secrets jamais devem ser enviados ao repositório.
