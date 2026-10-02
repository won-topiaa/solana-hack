// The agent page (milestone M9): chat with the agent next to the case it builds.
import { AgentApp } from "@/components/AgentApp";
import { AppFooter, AppHeader } from "@/components/AppHeader";
import { DEMO_PERSONAS } from "@/lib/recommend/personas";

export default function Home() {
  return (
    <>
      <AppHeader />
      <main className="flex-1">
        <AgentApp personas={DEMO_PERSONAS} />
      </main>
      <AppFooter />
    </>
  );
}
