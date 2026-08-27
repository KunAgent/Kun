import {
  createContext,
  useContext,
  type ReactElement,
  type ReactNode,
} from "react";

/**
 * The live-assistant typewriter stays off while the selected thread is
 * catching up or its persisted busy state is still unconfirmed. The provider
 * is mounted by the live assistant bubble; `streaming` carries that combined
 * presentation gate to nested Markdown renderers.
 */
const LiveAssistantStreamingContext = createContext<boolean>(true);

export function LiveAssistantStreamingProvider({
  streaming,
  children,
}: {
  streaming: boolean;
  children: ReactNode;
}): ReactElement {
  const parentStreaming = useContext(LiveAssistantStreamingContext);
  return (
    <LiveAssistantStreamingContext.Provider value={parentStreaming && streaming}>
      {children}
    </LiveAssistantStreamingContext.Provider>
  );
}

export function useLiveAssistantStreaming(): boolean {
  return useContext(LiveAssistantStreamingContext);
}
