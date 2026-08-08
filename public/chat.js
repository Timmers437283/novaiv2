```javascript
/**
 * NovaIV2 Chat App Frontend
 *
 * Handles chat UI interactions and communication with the backend API.
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
		content: "Hello! I'm NovaIV2. How can I help you today?",
	},
];

let isProcessing = false;

/**
 * Escape HTML to prevent the AI response from inserting actual HTML.
 */
function escapeHtml(text) {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

/**
 * Convert basic Markdown to HTML.
 *
 * Supports:
 * **bold**
 * *italic*
 * `code`
 */
function markdownToHtml(text) {
	let html = escapeHtml(text);

	// Bold: **text**
	html = html.replace(
		/\*\*(.+?)\*\*/g,
		"<strong>$1</strong>"
	);

	// Italic: *text*
	html = html.replace(
		/(?<!\*)\*([^*\n]+)\*(?!\*)/g,
		"<em>$1</em>"
	);

	// Inline code: `code`
	html = html.replace(
		/`([^`\n]+)`/g,
		"<code>$1</code>"
	);

	// Preserve line breaks
	html = html.replace(/\n/g, "<br>");

	return html;
}

// Auto-resize textarea
userInput.addEventListener("input", function () {
	this.style.height = "auto";
	this.style.height = this.scrollHeight + "px";
});

// Send message with Enter
userInput.addEventListener("keydown", function (e) {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();

		if (!isProcessing) {
			sendMessage();
		}
	}
});

// Send button
sendButton.addEventListener("click", function () {
	sendMessage();
});

/**
 * Sends a message to the chat API and processes the response.
 */
async function sendMessage() {
	const message = userInput.value.trim();

	if (message === "" || isProcessing) {
		return;
	}

	// Disable input
	isProcessing = true;
	userInput.disabled = true;
	sendButton.disabled = true;

	// Add user message
	addMessageToChat("user", message);

	// Clear input
	userInput.value = "";
	userInput.style.height = "auto";

	// Show typing indicator
	typingIndicator.classList.add("visible");

	// Add to history
	chatHistory.push({
		role: "user",
		content: message,
	});

	try {
		// Create assistant message
		const assistantMessageEl = document.createElement("div");
		assistantMessageEl.className =
			"message assistant-message";

		const assistantTextEl = document.createElement("p");

		assistantMessageEl.appendChild(assistantTextEl);
		chatMessages.appendChild(assistantMessageEl);

		chatMessages.scrollTop = chatMessages.scrollHeight;

		// Send API request
		const response = await fetch("/api/chat", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				messages: chatHistory,
			}),
		});

		if (!response.ok) {
			throw new Error("Failed to get response");
		}

		if (!response.body) {
			throw new Error("Response body is null");
		}

		// Read streaming response
		const reader = response.body.getReader();
		const decoder = new TextDecoder();

		let responseText = "";
		let buffer = "";
		let sawDone = false;

		function updateAssistantMessage() {
			assistantTextEl.innerHTML =
				markdownToHtml(responseText);

			chatMessages.scrollTop =
				chatMessages.scrollHeight;
		}

		while (true) {
			const { done, value } = await reader.read();

			if (done) {
				// Process anything remaining in the buffer
				const parsed = consumeSseEvents(
					buffer + "\n\n"
				);

				for (const data of parsed.events) {
					if (data === "[DONE]") {
						break;
					}

					processSseData(
						data,
						(content) => {
							responseText += content;
							updateAssistantMessage();
						}
					);
				}

				break;
			}

			buffer += decoder.decode(value, {
				stream: true,
			});

			const parsed = consumeSseEvents(buffer);
			buffer = parsed.buffer;

			for (const data of parsed.events) {
				if (data === "[DONE]") {
					sawDone = true;
					break;
				}

				processSseData(
					data,
					(content) => {
						responseText += content;
						updateAssistantMessage();
					}
				);
			}

			if (sawDone) {
				break;
			}
		}

		// Save assistant response
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
		typingIndicator.classList.remove("visible");

		isProcessing = false;
		userInput.disabled = false;
		sendButton.disabled = false;

		userInput.focus();
	}
}

/**
 * Processes one SSE data event.
 */
function processSseData(data, onContent) {
	try {
		const jsonData = JSON.parse(data);

		let content = "";

		// Cloudflare Workers AI format
		if (
			typeof jsonData.response === "string"
		) {
			content = jsonData.response;
		}

		// OpenAI-compatible format
		else if (
			jsonData.choices &&
			jsonData.choices[0] &&
			jsonData.choices[0].delta &&
			typeof jsonData.choices[0].delta.content ===
				"string"
		) {
			content =
				jsonData.choices[0].delta.content;
		}

		if (content) {
			onContent(content);
		}
	} catch (error) {
		console.error(
			"Error parsing SSE data:",
			error,
			data
		);
	}
}

/**
 * Adds a message to the chat.
 */
function addMessageToChat(role, content) {
	const messageEl = document.createElement("div");

	messageEl.className =
		"message " + role + "-message";

	const paragraph = document.createElement("p");

	if (role === "assistant") {
		paragraph.innerHTML =
			markdownToHtml(content);
	} else {
		paragraph.textContent = content;
	}

	messageEl.appendChild(paragraph);
	chatMessages.appendChild(messageEl);

	chatMessages.scrollTop =
		chatMessages.scrollHeight;
}

/**
 * Processes Server-Sent Events.
 */
function consumeSseEvents(buffer) {
	const normalized = buffer.replace(/\r/g, "");
	const events = [];

	let remaining = normalized;
	let eventEndIndex;

	while (
		(eventEndIndex =
			remaining.indexOf("\n\n")) !== -1
	) {
		const rawEvent = remaining.slice(
			0,
			eventEndIndex
		);

		remaining = remaining.slice(
			eventEndIndex + 2
		);

		const lines = rawEvent.split("\n");
		const dataLines = [];

		for (const line of lines) {
			if (line.startsWith("data:")) {
				dataLines.push(
					line.slice(5).trimStart()
				);
			}
		}

		if (dataLines.length > 0) {
			events.push(dataLines.join("\n"));
		}
	}

	return {
		events: events,
		buffer: remaining,
	};
}
```
