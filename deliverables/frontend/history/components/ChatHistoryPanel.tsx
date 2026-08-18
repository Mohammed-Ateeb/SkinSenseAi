'use client'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatHistoryPanelProps {
  llmExplanation: string | null
  chatHistory: ChatMessage[]
}

export default function ChatHistoryPanel({ llmExplanation, chatHistory }: ChatHistoryPanelProps) {
  // Reconstruct the conversation: initial assistant message = llm_explanation,
  // then any persisted follow-up messages from predictions.chat_history.
  const messages: ChatMessage[] = [
    ...(llmExplanation ? [{ role: 'assistant' as const, content: llmExplanation }] : []),
    ...chatHistory,
  ]

  if (!messages.length) {
    return (
      <p className="text-white/40 text-sm text-center py-6">
        No analysis explanation available for this scan.
      </p>
    )
  }

  return (
    <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
      {messages.map((msg, i) => (
        <div
          key={i}
          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`rounded-2xl px-4 py-3 max-w-[90%] text-sm leading-relaxed ${
              msg.role === 'user'
                ? 'bg-gradient-to-r from-[#a78bfa] to-[#60a5fa] text-white'
                : 'bg-white/10 text-white/90'
            }`}
          >
            {msg.content}
          </div>
        </div>
      ))}
    </div>
  )
}
