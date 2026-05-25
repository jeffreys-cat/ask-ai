"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();

  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      onClick={() =>
        authClient.signOut({
          fetchOptions: {
            onSuccess: () => {
              router.push("/sign-in");
              router.refresh();
            },
          },
        })
      }
    >
      <LogOut />
      Sign out
    </Button>
  );
}
