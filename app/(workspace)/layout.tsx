import { Suspense, type ReactNode } from "react";
import { BrainProvider } from "@/components/brain/BrainProvider";
import { AppSidebar } from "@/components/shell/Topbar";
import { Toast } from "@/components/shell/Toast";
import { requireUser } from "@/lib/auth/user";

// The whole workspace sits behind the session check, so nothing from it is in the prerendered shell.
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen" aria-busy="true" />}>
      <Workspace>{children}</Workspace>
    </Suspense>
  );
}

async function Workspace({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return (
    // keyed by user so one person's sample state never shows up for the next person on this browser
    <BrainProvider key={user.id} userId={user.id}>
      <div className="flex min-h-screen flex-col lg:flex-row">
        <Suspense fallback={<div className="lg:w-[248px]" />}>
          <AppSidebar user={{ name: user.name, email: user.email }} />
        </Suspense>
        <main className="mx-auto flex w-full max-w-[1440px] min-w-0 flex-1 flex-col gap-8 px-4 py-6 md:px-8 lg:py-8">{children}</main>
      </div>
      <Toast />
    </BrainProvider>
  );
}
