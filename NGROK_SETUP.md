# Ngrok Setup for Frame.io OAuth with Adobe IMS

Adobe IMS requires HTTPS redirect URIs for OAuth flows. For local development, we'll use ngrok to create a secure tunnel to your local service.

## Prerequisites

1. Install ngrok:
   ```bash
   # macOS
   brew install ngrok
   
   # Or download from https://ngrok.com/download
   ```

2. Sign up for a free ngrok account at https://ngrok.com to get an auth token

3. Configure ngrok with your auth token:
   ```bash
   ngrok config add-authtoken YOUR_AUTH_TOKEN
   ```

## Setup Steps

### 1. Start the Local Service

```bash
# Using Docker
docker-compose -f docker-compose.dev.yml up

# Or locally
npm run dev
```

Your service should be running on `http://localhost:8080`

### 2. Create Ngrok Tunnel

In a new terminal, create an HTTPS tunnel:

```bash
ngrok http 8080
```

You'll see output like:
```
Session Status                online
Account                       your-email@example.com
Version                       3.5.0
Region                        United States (us)
Latency                       32ms
Web Interface                 http://127.0.0.1:4040
Forwarding                    https://abc123xyz.ngrok-free.app -> http://localhost:8080

Connections                   ttl     opn     rt1     rt5     p50     p90
                             0       0       0.00    0.00    0.00    0.00
```

### 3. Configure Adobe Developer Console

1. Go to [Adobe Developer Console](https://developer.adobe.com/console)
2. Select your Frame.io integration
3. Go to "OAuth Web App" credentials
4. Add the redirect URI using your ngrok URL:
   ```
   https://abc123xyz.ngrok-free.app/auth/callback
   ```
   (Replace `abc123xyz` with your actual ngrok subdomain)

5. Save the configuration

### 4. Update Environment Variables

Update your `.env` file with the ngrok URL:

```env
# OAuth Configuration
FRAMEIO_CLIENT_ID=your_client_id_here
FRAMEIO_CLIENT_SECRET=your_client_secret_here

# Optional: Set the public URL for callbacks
PUBLIC_URL=https://abc123xyz.ngrok-free.app
```

### 5. Test OAuth Flow

1. Navigate to your ngrok URL:
   ```
   https://abc123xyz.ngrok-free.app/auth/authorize
   ```

2. You'll be redirected to Adobe IMS login
3. After authentication, you'll be redirected back to:
   ```
   https://abc123xyz.ngrok-free.app/auth/callback?code=xxx&state=xxx
   ```

4. The service will exchange the code for tokens

## Using a Persistent Ngrok Subdomain

For easier development, consider using a persistent subdomain (requires ngrok paid plan):

```bash
ngrok http 8080 --subdomain=your-custom-subdomain
```

This gives you a consistent URL:
```
https://your-custom-subdomain.ngrok-free.app
```

## Docker Compose with Ngrok

You can also add ngrok to your docker-compose for automated setup:

### docker-compose.ngrok.yml

```yaml
version: '3.8'

services:
  ngrok:
    image: ngrok/ngrok:latest
    container_name: lut-action-ngrok
    restart: unless-stopped
    command:
      - "http"
      - "http://web:8080"
    environment:
      NGROK_AUTHTOKEN: ${NGROK_AUTHTOKEN}
    ports:
      - "4040:4040" # Ngrok web interface
    networks:
      - lut-network-dev
    depends_on:
      - web-dev

networks:
  lut-network-dev:
    external: true
```

Run with:
```bash
# Start everything including ngrok
docker-compose -f docker-compose.dev.yml -f docker-compose.ngrok.yml up
```

Then check the ngrok web interface at http://localhost:4040 to get your HTTPS URL.

## Security Considerations

1. **Ngrok Inspection**: Anyone with your ngrok URL can access your local service. Be careful not to expose sensitive data.

2. **Request Inspection**: Ngrok provides a web interface at http://localhost:4040 where you can inspect all requests/responses.

3. **Rate Limits**: Free ngrok accounts have rate limits. For production testing, consider a paid plan.

4. **Webhook Testing**: You can also use ngrok for testing Frame.io webhooks:
   ```
   https://abc123xyz.ngrok-free.app/webhooks/frameio/custom-action
   ```

## Troubleshooting

### "Invalid redirect_uri" Error
- Ensure the exact ngrok URL is added to Adobe Developer Console
- Check that the protocol is HTTPS
- Verify there are no trailing slashes or extra parameters

### Ngrok Connection Refused
- Verify your local service is running on port 8080
- Check that Docker containers are running if using Docker
- Try restarting both the service and ngrok

### Session Expired
- Ngrok sessions expire after 2 hours on free plan
- Restart ngrok and update the redirect URI in Adobe Console
- Consider upgrading to a paid plan for longer sessions

## Alternative: Using Cloudflare Tunnel

If you prefer an alternative to ngrok, Cloudflare Tunnel (formerly Argo Tunnel) is another option:

```bash
# Install cloudflared
brew install cloudflare/cloudflare/cloudflared

# Create tunnel
cloudflared tunnel --url http://localhost:8080
```

This will give you a URL like:
```
https://random-name.trycloudflare.com
```

## Production Deployment

For production, you should:

1. Deploy to a cloud provider with HTTPS (AWS, Google Cloud, Azure, etc.)
2. Use a proper domain with SSL certificate
3. Configure the production redirect URI in Adobe Developer Console:
   ```
   https://your-domain.com/auth/callback
   ```
4. Update environment variables with production URLs
5. Implement proper token storage and session management