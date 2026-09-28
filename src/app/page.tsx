import { Chat } from "./chat";

export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const raw = params.c;
  const initialConversationId = typeof raw === "string" && raw.trim() !== "" ? raw : null;
  return <Chat initialConversationId={initialConversationId} />;
}
