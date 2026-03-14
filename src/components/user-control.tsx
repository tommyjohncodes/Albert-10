"use client";

import { dark } from "@clerk/themes";
import { UserButton } from "@clerk/nextjs";

import { useCurrentTheme } from "@/hooks/use-current-theme";
import { UserMetrics } from "@/components/user-metrics";

interface Props {
  showName?: boolean;
};

export const UserControl = ({ showName }: Props) => {
  const currentTheme = useCurrentTheme();

  return (
    <div className="flex items-center gap-3">
      <UserMetrics />
      <UserButton
        showName={showName}
        appearance={{
          elements: {
            userButtonBox: "rounded-md!",
            userButtonAvatarBox: "rounded-md! size-8!",
            userButtonTrigger: "rounded-md!"
          },
          baseTheme: currentTheme === "dark" ? dark : undefined,
        }}
      />
    </div>
  );
};
