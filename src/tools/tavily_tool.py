from tavily import TavilyClient
import os
from dotenv import load_dotenv

load_dotenv()

client = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))

def tavily_search(query):
    results = []
    response = client.search(query, max_results=2)
    for result in response.get("results", []):
        results.append({
            "title": result["title"],
            "url": result["url"],
            "content": result["content"] if len(result["content"]) < 300 else result["content"][:300] + "..."
        })
    return "\n".join([f"Title: {result['title']}\nURL: {result['url']}\nContent: {result['content']}\n" for result in results])

if __name__ == "__main__":
    query = "Best travel destinations in Europe"
    search_results = tavily_search(query)
    print(search_results)

