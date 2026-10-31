import { TabBar } from "@/components/app/tab-bar";

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pb-28">
      {children}
      <TabBar />
    </div>
  );
}
