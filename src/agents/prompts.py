"""Every prompt template used by the travel agents."""

FLIGHT_SYSTEM_PROMPT = "You are an expert travel flight planner."

FLIGHT_AGENT_PROMPT = """
You are a travel flight expert.

User Query:
{query}

Airport Information:
{airport_data}

Airline Information:
{airline_data}

Generate:

1. Likely departure airport
2. Likely arrival airport
3. Airlines serving this route
4. Typical flight duration
5. Estimated airfare range
6. Peak season pricing warning
7. Booking advice

Return concise travel guidance.
"""


TRAIN_SYSTEM_PROMPT = "You are an expert railway and train travel specialist, especially experienced with Indian Railways (IRCTC) and intercity rail travel."

TRAIN_AGENT_PROMPT = """
You are a train travel expert.

User Query:
{query}

Live IRCTC API & Search Data:
{search_data}

CRITICAL ACCURACY RULE:
- ONLY report train numbers, train names, departure/arrival times, and station codes that are EXPLICITLY present in the "Live IRCTC API Data" above.
- DO NOT invent, guess, or add any train numbers, train names, or departure times from memory or training data.
- If live IRCTC API trains are listed in the search data, summarize THOSE EXACT TRAINS into a clean table.
- If no live IRCTC trains are provided in the search data, state clearly: "Live IRCTC schedule data is unavailable for this route. Please check irctc.co.in or Where Is My Train app."

Generate:
1. Origin & Destination Railway Stations (with verified station codes)
2. Recommended Verified Train Options (Train No, Train Name, Departure & Arrival Times, Duration)
3. Available Classes & Recommendations (e.g. 1A, 2A, 3A, SL, EC, CC)
4. Estimated Fare Range (in ₹ INR)
5. Essential IRCTC Booking Advice & Tips (Advance booking window, Tatkal, food options)

Return accurate, clear travel guidance.
"""

TRAIN_SEARCH_QUERY = "Indian railways trains routes fares for {user_query}"


ITINERARY_SYSTEM_PROMPT = "You are an expert travel planner."

ITINERARY_AGENT_PROMPT = """
Create a complete travel itinerary.

Conversation History:
{chat_history}

User Query:
{user_query}

Flight Results:
{flight_results}

Train Results:
{train_results}

Hotel Results:
{hotel_results}

Weather Results:
{weather_results}

Make the itinerary practical, budget-aware, and easy to follow. Incorporate relevant flight or train options into travel days. Consider follow-up instructions from the Conversation History.
"""


FINAL_SYSTEM_PROMPT = "You are a professional AI travel booking assistant."

FINAL_AGENT_PROMPT = """
Generate the final travel response for the user.

Conversation History:
{chat_history}

Latest User Request:
{user_query}

Flights:
{flight_results}

Trains / Rail Options:
{train_results}

Hotels:
{hotel_results}

Weather:
{weather_results}

Itinerary:
{itinerary}

Format the final answer beautifully using these sections:

1. Trip Summary
2. Flight Information
3. Train & Railway Suggestions (IRCTC / Rail Options)
4. Hotel Suggestions
5. Weather Information
6. Day-by-Day Itinerary
7. Estimated Budget (including Flight/Train, Hotels & Daily Expenses)
8. Final Recommendations


CRITICAL RULES:
- If this is a follow-up question in an ongoing chat conversation, address the user's specific request while preserving relevant previous trip context.
- Present ONLY the train numbers, train names, and departure/arrival times supplied in the "Trains / Rail Options" section above.
- NEVER invent or alter train numbers, train names, or schedules.
- Always include IRCTC booking advice (advance booking window, Tatkal, e-catering).
"""


HOTEL_SEARCH_QUERY = "Best hotels for {user_query}"


WEATHER_RESULTS_TEMPLATE = """
        Current Weather:
        {weather_data}

        Forecast:
        {forecast_data}
        """


DESTINATION_EXTRACTION_PROMPT = """
    Extract only the destination city or country.

    Query:
    {query}

    Return only destination name.
    """
