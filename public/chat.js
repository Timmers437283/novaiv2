```javascript
/**
 * LLM Chat App Frontend
 *
 * Handles the chat UI interactions and communication with the backend API.
 */

// DOM elements
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");

// Chat state
let chatHistory = [
	{
		role: "assistant",
		content:
			"Hello! I'm NovaIV2. How can I help you today?",
	},
];

let isProcessing = false;

// Auto-resize textarea as user types
userInput.addEventListener("input", function () {
	this.style.height = "auto";
	this.style.height = this.scrollHeight + "px";
});

// Send message on Enter (without Shift)
userInput.addEventListener("keydown", function (e) {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		sendMessage();
	}
});

// Send button click handler
sendButton.addEventListener("click", sendMessage);

/**
 * Escapes HTML so AI responses cannot inject HTML into the page.
 */
function escapeHtml(text) {
	const div = document.createElement("div");
	div.textContent = text;
	return div.innerHTML;
}

/**
 * Converts basic Markdown into safe HTML.
 *
 * Supported:
 * **bold**
 * *italic*
 * `code`
 * [links](https://example.com)
 * bullet points
 * numbered lists
 * headings
 */
function markdownToHtml(text) {
	let html = escapeHtml(text);

	// Code
	html = html.replace(
		/`([^`\n]+)`/g,
		"<code>$1</code>"
	);

	// Bold
	html = html.replace(
		/\*\*(.+?)\*\*/g,
		"<strong>$1</strong>"
	);

	// Italic
	html = html.replace(
		/(?<!\*)\*([^*\n]+)\*(?!\*)/g,
		"<em>$1</em>"
	);

	// Headings
	html = html.replace(
		/^### (.+)$/gm,
		"<h3>$1</h3>"
	);

	html = html.replace(
		/^## (.+)$/gm,
		"<h2>$1</h2>"
	);

	html = html.replace(
		/^# (.+)$/gm,
		"<h1>$1</h1>"
	);

	// Links
	html = html.replace(
		/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
		'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
	);

	// Bullet points
	html = html.replace(
		/^[ \t]*[-*] (.+)$/gm,
		"<li>$1</li>"
	);

	// Numbered lists
	html = html.replace(
		/^[ \t]*\d+\. (.+)$/gm,
		"<li>$1</li>"
	);

	// Group consecutive list items
	html = html.replace(
		/(?:<li>.*?<\/li>\n?)+/gs,
		"<ul>$&</ul>"
	);

	// Line breaks
	html = html.replace(/\n/g, "<br>");

	return html;
}

/**
 * Sends a message to the chat API and processes the response.
 */
async function sendMessage() {
	const message = userInput.value.trim();

	// Don't send empty messages
	if (message === "" || isProcessing) return;

	// Disable input while processing
	isProcessing = true;
	userInput.disabled = true;
	sendButton.disabled = true;

	// Add user message to chat
	addMessageToChat("user", message);

	// Clear input
	userInput.value = "";
	userInput.style.height = "auto";

	// Show typing indicator
	typingIndicator.classList.add("visible");

	// Add message to history
	chatHistory.push({
		role: "user",
		content: message,
	});

	try {
		// Create new assistant response element
		const assistantMessageEl = document.createElement("div");
		assistantMessageEl.className = "message assistant-message";

		const assistantTextEl = document.createElement("p");

		assistantMessageEl.appendChild(assistantTextEl);
		chatMessages.appendChild(assistantMessageEl);

		// Scroll to bottom
		chatMessages.scrollTop = chatMessages.scrollHeight;

		// Send request to API
		const response = await fetch("/api/chat", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				messages: chatHistory,
			}),
		});

		// Handle errors
		if (!response.ok) {
			throw new Error("Failed to get response");
		}

		if (!response.body) {
			throw new Error("Response body is null");
		}

		// Process streaming response
		const reader = response.body.getReader();
		const decoder = new TextDecoder();

		let responseText = "";
		let buffer = "";
		let sawDone = false;

		const flushAssistantText = () => {
			assistantTextEl.innerHTML = markdownToHtml(responseText);
			chatMessages.scrollTop = chatMessages.scrollHeight;
		};

		while (true) {
			const { done, value } = await reader.read();

			if (done) {
				// Process any remaining complete events in buffer
				const parsed = consumeSseEvents(buffer + "\n\n");

				for (const data of parsed.events) {
					if (data === "[DONE]") {
						break;
					}

					try {
						const jsonData = JSON.parse(data);

						let content = "";

						// Workers AI format
						if (
							typeof jsonData.response === "string" &&
							jsonData.response.length > 0
						) {
							content = jsonData.response;
						}

						// OpenAI format
						else if (
							jsonData.choices?.[0]?.delta?.content
						) {
							content =
								jsonData.choices[0].delta.content;
						}

						if (content) {
							responseText += content;
							flushAssistantText();
						}
					} catch (e) {
						console.error(
							"Error parsing SSE data as JSON:",
							e,
							data
						);
					}
				}

				break;
			}

			// Decode chunk
			buffer += decoder.decode(value, {
				stream: true,
			});

			const parsed = consumeSseEvents(buffer);
			buffer = parsed.buffer;

			for (const data of parsed.events) {
				if (data === "[DONE]") {
					sawDone = true;
					buffer = "";
					break;
				}

				try {
					const jsonData = JSON.parse(data);

					let content = "";

					// Workers AI format
					if (
						typeof jsonData.response === "string" &&
						jsonData.response.length > 0
					) {
						content = jsonData.response;
					}

					// OpenAI format
					else if (
						jsonData.choices?.[0]?.delta?.content
					) {
						content =
							jsonData.choices[0].delta.content;
					}

					if (content) {
						responseText += content;
						flushAssistantText();
					}
				} catch (e) {
					console.error(
						"Error parsing SSE data as JSON:",
						e,
						data
					);
				}
			}

			if (sawDone) {
				break;
			}
		}

		// Add completed response to chat history
		if (responseText.length > 0) {
			chatHistory.push({
				role: "assistant",
				content: responseText,
			});
		}
	} catch (error) {
		console.error("Error:", error);

		addMessageToChat(
			"assistant",
			"Sorry, there was an error processing your request."
		);
	} finally {
		// Hide typing indicator
		typingIndicator.classList.remove("visible");

		// Re-enable input
		isProcessing = false;
		userInput.disabled = false;
		sendButton.disabled = false;

		userInput.focus();
	}
}

/**
 * Helper function to add message to chat.
 */
function addMessageToChat(role, content) {
	const messageEl = document.createElement("div");
	messageEl.className = `message ${role}-message`;

	const paragraph = document.createElement("p");

	if (role === "assistant") {
		paragraph.innerHTML = markdownToHtml(content);
	} else {
		paragraph.textContent = content;
	}

	messageEl.appendChild(paragraph);
	chatMessages.appendChild(messageEl);

	// Scroll to bottom
	chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Processes Server-Sent Events.
 */
function consumeSseEvents(buffer) {
	let normalized = buffer.replace(/\r/g, "");
	const events = [];
	let eventEndIndex;

	while (
		(eventEndIndex = normalized.indexOf("\n\n")) !== -1
	) {
		const rawEvent = normalized.slice(
			0,
			eventEndIndex
		);

		normalized = normalized.slice(
			eventEndIndex + 2
		);

		const lines = rawEvent.split("\n");
		const dataLines = [];

		for (const line of lines) {
			if (line.startsWith("data:")) {
				dataLines.push(
					line.slice("data:".length).trimStart()
				);
			}
		}

		if (dataLines.length === 0) continue;

		events.push(dataLines.join("\n"));
	}

	return {
		events,
		buffer: normalized,
	};
}
```
