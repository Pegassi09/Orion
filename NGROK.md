# Túnel Ngrok

O projeto usa o pacote oficial `@ngrok/ngrok` para expor o servidor HTTP local após sua inicialização.

## Configuração

Preencha as variáveis no arquivo `.env` (não versionado):

```dotenv
# Token oficial do Ngrok
NGROK_AUTHTOKEN= 3HGyDX6aFIEdAQASx4BRkhujnXr_3NDd6CnJMCHC66XBXjmK4

# Região do túnel
NGROK_REGION=us

# Domínio personalizado (opcional)
NGROK_DOMAIN=orion.com.br
```

Execute `npm start` ou `npm run dev`. A URL HTTPS pública é mostrada no terminal após o endereço local. Sem `NGROK_AUTHTOKEN`, o servidor permanece disponível localmente e o túnel é ignorado.

## Operação e solução de problemas

- Token inválido, sem permissão, limite de conexões, timeout, rede indisponível ou domínio em conflito são exibidos no terminal e não derrubam o servidor.
- Para domínio próprio, registre o domínio e seu DNS no painel do Ngrok antes de preencher `NGROK_DOMAIN`.
- Use uma região suportada pela sua conta, como `us`, em `NGROK_REGION`.
- `SIGINT`, `SIGTERM`, rejeições não tratadas e exceções não capturadas encerram o listener do Ngrok antes do processo terminar.

O túnel não é iniciado em execução serverless (`VERCEL`), pois não há servidor HTTP persistente para encaminhar.
