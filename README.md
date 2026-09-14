<h1 align="center">NaviGo AI — Multi-Agent Travel Planner</h1>

<p align="center">
  <img src="https://img.shields.io/badge/status-active-success.svg" alt="Status">
  <a href="https://github.com/KalyanM45/TravelBrain-Multi-Agent-AI-Travel-Planner/issues"><img src="https://img.shields.io/github/issues/KalyanM45/TravelBrain-Multi-Agent-AI-Travel-Planner.svg" alt="GitHub Issues"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-blue.svg" alt="License"></a>
</p>

---

<p align="center">
  A state-of-the-art, multi-agent AI travel planning platform built from scratch with <strong>LangGraph</strong>, <strong>FastAPI</strong>, <strong>Groq LLMs</strong>, and live travel data APIs. Describe your trip in plain English and receive complete, verified itineraries with flights, Indian Railways train schedules, hotels, live weather forecasts, and cost breakdowns in about a minute.
</p>

## 📝 Table of Contents

- [About The Project](#about)
- [Architecture & Multi-Agent Flow](#architecture)
- [Key Features & Enhancements](#key-features)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Usage & Follow-Up Conversations](#usage)
- [License](#license)

---

## 🧐 About The Project <a name="about"></a>

Planning travel traditionally requires juggling multiple browser tabs for flights, train tickets, hotel bookings, weather forecasts, and budgeting. 

**NaviGo AI** collapses all of that research into a single conversational interface powered by a team of autonomous AI specialists working in parallel:

| Specialist Agent | What It Researches |
|---|---|
| ✈️ **Flight Agent** | Airport IATA codes, airlines, typical flight durations, and airfare estimates |
| 🚆 **Train Agent** | Live IRCTC Indian Railways routes, Vande Bharat/Rajdhani schedules, station codes (e.g. NDLS, BSB, MAO), class recommendations (1A, 2A, 3A, SL, EC, CC), and booking advice |
| 🏨 **Hotel Agent** | Destination-matched hotel accommodations, price tiers, and location convenience |
| 🌤️ **Weather Agent** | Live temperature, humidity, wind conditions, multi-day forecasts, and travel advice |
| 🗺️ **Itinerary Agent** | Day-by-day practical schedule integrating flights, trains, and local activities |
| 💰 **Final Synthesizer** | Assembles everything into a clean Markdown plan with itemized budget breakdowns |

---

## 🏗️ Architecture & Multi-Agent Flow <a name="architecture"></a>

NaviGo is engineered using **LangGraph** graph state orchestration:

```
[START]
   │
   ▼
[Flight Agent] ──── (AviationStack API)
   │
   ▼
[Train Agent]  ──── (RapidAPI IRCTC Live API + Verified Fallback)
   │
   ▼
[Hotel Agent]  ──── (Tavily Search Engine)
   │
   ▼
[Weather Agent] ─── (OpenWeather API)
   │
   ▼
[Itinerary Agent] ── (Multi-Turn Plan Synthesis)
   │
   ▼
[Final Agent]   ──── (Markdown Formatter & Budget Estimator)
   │
   ▼
 [END]  ───────► Saved to Supabase PostgreSQL Checkpointer
```

---

## ✨ Key Features & Enhancements <a name="key-features"></a>

### 🚆 1. Indian Railways & Live IRCTC Integration (`train_agent.py`)
- Integrated **RapidAPI IRCTC client** (`irctc1.p.rapidapi.com`) to query live train numbers, exact departure/arrival times, durations, and run days for Indian intercity rail routes.
- **Anti-Hallucination Safeguards**: Enforces strict grounding rules so train numbers and schedules match active IRCTC records.
- **Rate-Limit Resilience & Verified Fallback**: Includes LRU caching and an offline dataset for popular routes (`NDLS <-> BSB`, `MMCT <-> MAO`, etc.) if API rate limits (HTTP 429) occur.

### 💬 2. Multi-Turn Conversation Context Window & Chat Memory
- **Thread State Persistence**: Utilizes Supabase PostgreSQL checkpointer (`PostgresSaver`) with `MemorySaver` fallback to retain conversation threads.
- **Context Window Engine**: `format_chat_history` extracts recent turns (`HumanMessage` and `AIMessage`) and passes chat context to all specialist nodes.
- **Context-Aware Follow-Ups**: Allows users to refine existing plans (e.g., *"Switch hotel to 5-star luxury"* or *"Show train options for this route"*) without re-typing origin, destination, or travel dates.

### ⚡ 3. Rate Limit & Token Budget Optimization
- Implemented payload trimming (`_trim()`) across agent prompt inputs to respect token-per-minute (TPM) limits on Groq free-tier inference (`openai/gpt-oss-20b`).

---

## 🏁 Getting Started <a name="getting-started"></a>

### Prerequisites

- **Python 3.11+**
- **[uv](https://docs.astral.sh/uv/)** package manager
- **PostgreSQL Database** (e.g., free instance on Supabase, Render, or Neon)
- **API Keys**: Groq, Tavily, AviationStack, OpenWeather, and RapidAPI (IRCTC)

### Installation

1. Clone the repository:
   ```bash
   git clone /https://github.com/Afroz-ali17/NaviGo_AI.git
   cd TravelBrain-Multi-Agent-AI-Travel-Planner
   ```

2. Install dependencies using `uv`:
   ```bash
   uv sync
   ```

3. Create a `.env` file in the project root:
   ```dotenv
   # LLM Provider
   GROQ_API_KEY=gsk_your_groq_key_here
   GROQ_MODEL=openai/gpt-oss-20b

   # PostgreSQL Persistence (Supabase / Render)
   DATABASE_URL=postgresql://postgres.ref:password@db.ref.supabase.co:5432/postgres?sslmode=require

   # Travel & Search APIs
   TAVILY_API_KEY=tvly-your_tavily_key
   AVIATIONSTACK_API_KEY=your_aviationstack_key
   OPENWEATHER_API_KEY=your_openweather_key
   RAPIDAPI_KEY=your_rapidapi_irctc_key

   # Server Settings
   HOST=127.0.0.1
   PORT=8000
   RELOAD=true
   ```

4. Start the application:
   ```bash
   uv run python app.py
   ```

5. Open **`http://127.0.0.1:8000`** in your browser.

---

## 🔑 Environment Variables <a name="environment-variables"></a>

| Variable | Required | Purpose |
|---|:---:|---|
| `GROQ_API_KEY` | ✅ | Fast AI inference for agent node decision-making |
| `DATABASE_URL` | ✅ | Supabase / PostgreSQL checkpointer for thread history persistence |
| `TAVILY_API_KEY` | ✅ | Web search engine for live hotel research |
| `AVIATIONSTACK_API_KEY` | ✅ | Flight information and airport code resolution |
| `OPENWEATHER_API_KEY` | ✅ | Real-time weather data & multi-day forecasts |
| `RAPIDAPI_KEY` | ✅ | Live IRCTC Indian Railways train search & station code lookup |
| `GROQ_MODEL` | ❌ | Model selection (default: `openai/gpt-oss-20b`) |

---

## 🎈 Usage <a name="usage"></a>

### Planning a New Trip
Enter your request into the chat box or use the **Trip Builder**:
> *"Plan a 5 day trip from Delhi to Varanasi by Vande Bharat train or flight, with mid-range hotels and an itinerary."*

### Multi-Turn Follow-Up Conversations
Once a plan is generated, ask follow-up questions within the same thread:
> *"Can you switch the accommodation to 5-star luxury hotels and update the estimated budget?"*
> *"What are the best local dishes to try in Varanasi?"*

The agent retains the full conversation context window and updates your itinerary accordingly.

---

## 📄 License <a name="license"></a>

Licensed under the **GNU General Public License v3.0**. See [LICENSE](LICENSE).
