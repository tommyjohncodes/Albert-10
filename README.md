# Vibe

AI-powered development platform that lets you create web applications by chatting with AI agents in real-time sandboxes.

## Features

- 🤖 AI-powered code generation with AI agents
- 💻 Real-time Next.js application development in E2B sandboxes
- 🔄 Live preview & code preview with split-pane interface
- 📁 File explorer with syntax highlighting and code theme
- 💬 Conversational project development with message history
- 🎯 Smart usage tracking and rate limiting
- 💳 Subscription management with pro features
- 🔐 Authentication with Clerk
- ⚙️ Background job processing with Inngest
- 🗃️ Project management and persistence

## Tech Stack

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS v4
- Shadcn/ui
- tRPC
- Prisma ORM
- PostgreSQL
- OpenAI, Anthropic or Grok
- E2B Code Interpreter
- Clerk Authentication
- Inngest
- Prisma
- Radix UI
- Lucide React

## Building E2B Template (REQUIRED)

Before running the application, you must build the E2B template that the AI agents use to create sandboxes.

**Prerequisites:**
- Docker must be installed and running (the template build command uses Docker CLI)

```bash
# Install E2B CLI
npm i -g @e2b/cli
# or
brew install e2b

# Login to E2B
e2b auth login

# Navigate to the sandbox template directory
cd sandbox-templates/nextjs

# Build the template (replace 'your-template-name' with your desired name)
e2b template build --name your-template-name --cmd "/compile_page.sh"
```

After building the template, update the template name in `src/inngest/functions.ts`:

```typescript
// Replace "vibe-nextjs-test-2" with your template name
const sandbox = await Sandbox.create("your-template-name");
```

## Development

```bash
# Install dependencies
npm install

# Set up environment variables
cp env.example .env
# Fill in your API keys and database URL

# Set up database
npx prisma migrate dev # Enter name "init" for migration

# Start development server
npm run dev
```

## Environment Variables

Create a `.env` file with the following variables:

```bash
DATABASE_URL=""
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# Inngest (Cloud)
INNGEST_EVENT_KEY=""
INNGEST_DEV="0"
INNGEST_SIGNING_KEY=""
INNGEST_SERVE_HOST=""

# OpenAI
OPENAI_API_KEY=""

# LLM Provider
LLM_PROVIDER="openai"
LLM_MODEL=""
LLM_TITLE_MODEL=""
LLM_RESPONSE_MODEL=""

# OpenRouter (optional)
OPENROUTER_API_KEY=""
OPENROUTER_BASE_URL="https://openrouter.ai/api/v1/"
OPENROUTER_REFERRER=""
OPENROUTER_TITLE=""
OPENROUTER_KEY_ENCRYPTION_KEY=""
OPENROUTER_KEY_ENCRYPTION_KEY=""

# Platform Org (for admin LLM settings)
PLATFORM_ORG_ID=""

# Admin access (comma-separated Clerk user IDs)
ADMIN_USER_IDS=""

# E2B
E2B_API_KEY=""

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=""
CLERK_SECRET_KEY=""
NEXT_PUBLIC_CLERK_SIGN_IN_URL="/sign-in"
NEXT_PUBLIC_CLERK_SIGN_UP_URL="/sign-up"
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL="/"
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL="/"
```

## Permanent Local Inngest Tunnel (Cloudflare)

To keep a stable `INNGEST_SERVE_HOST` for local development, use a named Cloudflare tunnel with a fixed hostname.

1. Install and authenticate cloudflared:
   ```bash
   brew install cloudflared
   cloudflared login
   ```

2. Create a named tunnel and map it to a hostname:
   ```bash
   cloudflared tunnel create albert-dev
   cloudflared tunnel route dns albert-dev dev.your-domain.com
   ```

3. Create a local config from the template:
   ```bash
   cp cloudflared/config.example.yml cloudflared/config.yml
   ```
   Update `cloudflared/config.yml` with your tunnel ID/name, credentials file path, and hostname.

4. Run the tunnel:
   ```bash
   npm run tunnel
   ```

5. Update `.env`:
   ```bash
   INNGEST_SERVE_HOST="https://dev.your-domain.com"
   ```

Keep the tunnel running while `npm run dev` is running. The hostname stays stable across restarts.

When `LLM_PROVIDER` is set to `openrouter`, the default model is `z-ai/glm-5` unless you override `LLM_MODEL`.

## Admin Panel

- Visit `/admin` as an allowlisted admin user.
- Set `ADMIN_USER_IDS` to one or more Clerk user IDs (comma-separated) to grant admin access.
- Org detail pages allow setting per-org provider/model and an encrypted per-org OpenRouter key.
- Admin pages include org and user LLM usage metrics (totals, daily chart, usage by provider, usage by model).

## Additional Commands

```bash
# Database
npm run postinstall        # Generate Prisma client
npx prisma studio          # Open database studio
npx prisma migrate dev     # Migrate schema changes
npx prisma migrate reset   # Reset database (Only for development)

# Build
npm run build          # Build for production
npm run start          # Start production server
npm run lint           # Run ESLint
```

## Project Structure

- `src/app/` - Next.js app router pages and layouts
- `src/components/` - Reusable UI components and file explorer
- `src/modules/` - Feature-specific modules (projects, messages, usage)
- `src/inngest/` - Background job functions and AI agent logic
- `src/lib/` - Utilities and database client
- `src/trpc/` - tRPC router and client setup
- `prisma/` - Database schema and migrations
- `sandbox-templates/` - E2B sandbox configuration

## How It Works

1. **Project Creation**: Users create projects and describe what they want to build
2. **AI Processing**: Messages are sent to LLM agents via Inngest background jobs
3. **Code Generation**: AI agents use E2B sandboxes to generate and test Next.js applications
4. **Real-time Updates**: Generated code and previews are displayed in split-pane interface
5. **File Management**: Users can browse generated files with syntax highlighting
6. **Iteration**: Conversational development allows for refinements and additions

---

Created by [CodeWithAntonio](https://codewithantonio.com)
