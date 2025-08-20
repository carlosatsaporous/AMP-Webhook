# 🚀 AMP Email Webhook Server

A flexible, secure webhook server designed to handle AMP email form submissions with dynamic form structure support, signature validation, and comprehensive admin interface.

## ✨ Features

- **🔄 Dynamic Form Handling**: Works with any AMP form structure automatically
- **🔐 AMP Signature Validation**: Validates Google's AMP signatures for security
- **📊 Admin Dashboard**: Beautiful web interface to view and manage submissions
- **🛡️ Security**: Rate limiting, CORS, helmet protection, and input validation
- **📈 Analytics**: Comprehensive logging and statistics
- **💾 Flexible Storage**: In-memory, file-based, or PostgreSQL storage options
- **🚫 Privacy**: Supports `doNotTrackThis` parameter for privacy compliance
- **📤 Export**: JSON and CSV export functionality
- **🧪 Development Tools**: Test endpoints and development mode

## 🚀 Quick Start

### 1. Installation

```bash
# Clone or download the project
cd amp-webhook

# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Edit .env file with your settings
nano .env
```

### 2. Configuration

Edit the `.env` file:

```env
PORT=3000
NODE_ENV=development
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_secure_password
AMP_VALIDATE_SIGNATURES=false  # Set to true in production
```

### 3. Start the Server

```bash
# Development mode
npm run dev

# Production mode
npm run build
npm start
```

### 4. Update Your AMP Email

Replace your webhook.site URLs with:

```html
<!-- Before -->
<form method="post" action-xhr="https://webhook.site/your-id?doNotTrackThis=1">

<!-- After -->
<form method="post" action-xhr="http://localhost:3000/webhook?doNotTrackThis=1">
```

## 📡 API Endpoints

### Webhook Endpoints

- `POST /webhook` - Main AMP form submission endpoint
- `GET /health` - Health check
- `GET /stats` - Public statistics
- `POST /test` - Test endpoint for development

### Admin Endpoints

- `GET /admin` - Admin dashboard (requires authentication)
- `GET /admin/api/stats` - Admin statistics (JSON)
- `GET /admin/api/submissions` - List submissions with filtering
- `GET /admin/api/submissions/:id` - Get specific submission
- `GET /admin/api/export` - Export submissions (JSON/CSV)
- `POST /admin/api/cleanup` - Cleanup old submissions

## 🔧 Configuration Options

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Environment mode |
| `DATABASE_TYPE` | `file` | Storage type (memory/file/postgresql) |
| `AMP_VALIDATE_SIGNATURES` | `true` | Enable AMP signature validation |
| `ADMIN_ENABLED` | `true` | Enable admin interface |
| `ADMIN_USERNAME` | `admin` | Admin username |
| `ADMIN_PASSWORD` | `admin123` | Admin password |
| `RATE_LIMIT_MAX` | `100` | Requests per window |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Rate limit window (15 min) |

### CORS Configuration

The server is pre-configured for major email providers:

- Gmail (`https://mail.google.com`)
- Outlook (`https://outlook.live.com`, `https://outlook.office.com`)
- AMP Project domains (`https://*.ampproject.org`)

## 📝 AMP Email Integration

### Basic Form Example

```html
<!DOCTYPE html>
<html amp4email data-css-strict>
<head>
  <meta charset="utf-8">
  <script async src="https://cdn.ampproject.org/v0.js"></script>
  <script async custom-element="amp-form" src="https://cdn.ampproject.org/v0/amp-form-0.1.js"></script>
  <style amp4email-boilerplate>body{visibility:hidden}</style>
</head>
<body>
  <form method="post" action-xhr="http://localhost:3000/webhook?doNotTrackThis=1">
    <input type="hidden" name="choice" value="option1">
    <input type="email" name="email" placeholder="Your email" required>
    <button type="submit">Submit</button>
  </form>
</body>
</html>
```

### Poll Form Example (Like Your Code)

```html
<!-- Poll buttons -->
<button class="poll-option" 
        on="tap:poll.hide,thankYou.show,formInteractive.submit">
  ⚡ Interactive elements
</button>

<!-- Hidden form -->
<form id="formInteractive" method="post" 
      action-xhr="http://localhost:3000/webhook?doNotTrackThis=1">
  <input type="hidden" name="choice" value="interactive">
</form>
```

## 🛡️ Security Features

### AMP Signature Validation

The webhook validates AMP signatures using Google's public keys:

- Fetches current public keys from Google
- Validates signature and timestamp
- Prevents replay attacks
- Can be disabled for development

### Rate Limiting

- 100 requests per 15 minutes per IP
- Configurable limits
- Proper error responses

### CORS Protection

- Whitelist-based origin validation
- Supports wildcard patterns
- AMP-specific headers

## 📊 Admin Dashboard

Access the admin dashboard at `http://localhost:3000/admin`

**Features:**
- Real-time statistics
- Form submission history
- Export functionality
- Search and filtering
- Cleanup tools

**Default Credentials:**
- Username: `admin`
- Password: `admin123` (change in production!)

## 🗄️ Storage Options

### File Storage (Default)

```env
DATABASE_TYPE=file
```

Stores submissions in `data/submissions.json`

### Memory Storage

```env
DATABASE_TYPE=memory
```

Stores submissions in memory (lost on restart)

### PostgreSQL Storage

```env
DATABASE_TYPE=postgresql
DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
```

## 🧪 Testing

### Test Endpoint

```bash
curl -X POST http://localhost:3000/test \
  -H "Content-Type: application/json" \
  -d '{"test": "data", "choice": "interactive"}'
```

### Health Check

```bash
curl http://localhost:3000/health
```

## 📈 Monitoring

### Logs

Logs are written to:
- Console (development)
- `logs/error.log` (errors only)
- `logs/combined.log` (all logs)

### Statistics

View public stats at `http://localhost:3000/stats`

## 🚀 Deployment

### Production Checklist

1. **Environment Variables**
   ```env
   NODE_ENV=production
   AMP_VALIDATE_SIGNATURES=true
   ADMIN_PASSWORD=secure_password_here
   ```

2. **HTTPS Setup**
   - Use reverse proxy (nginx, Apache)
   - SSL certificate required for AMP

3. **Database**
   - Use PostgreSQL for production
   - Regular backups

4. **Security**
   - Change default admin password
   - Configure proper CORS origins
   - Set up monitoring

### Docker Deployment

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

### Vercel Deployment

```json
{
  "version": 2,
  "builds": [
    {
      "src": "dist/server.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "dist/server.js"
    }
  ]
}
```

## 🔧 Development

### Scripts

```bash
npm run dev      # Start development server with hot reload
npm run build    # Build TypeScript to JavaScript
npm start        # Start production server
npm run check    # Run type checking and linting
```

### Project Structure

```
amp-webhook/
├── src/
│   ├── types/           # TypeScript type definitions
│   ├── services/        # Business logic services
│   ├── middleware/      # Express middleware
│   ├── routes/          # API routes
│   ├── utils/           # Utility functions
│   ├── app.ts           # Express application
│   └── server.ts        # Server entry point
├── config/              # Configuration files
├── logs/                # Log files
├── data/                # File storage (if using file storage)
└── dist/                # Compiled JavaScript
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

### Common Issues

**Port already in use:**
```bash
# Find process using port 3000
lsof -i :3000
# Kill the process
kill -9 <PID>
```

**AMP signature validation fails:**
- Set `AMP_VALIDATE_SIGNATURES=false` for development
- Ensure your server has internet access to fetch Google's keys
- Check server time is synchronized

**CORS errors:**
- Add your email provider's domain to CORS origins
- Ensure HTTPS in production

### Getting Help

- Check the logs in `logs/` directory
- Use the test endpoint to verify functionality
- Enable debug logging with `LOG_LEVEL=debug`

---

**Made with ❤️ for AMP Email developers**