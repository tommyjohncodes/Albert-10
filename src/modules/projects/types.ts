import { Fragment } from "@/generated/prisma";

export type FragmentPreview = Pick<
  Fragment,
  "id" | "sandboxUrl" | "title" | "summary" | "createdAt" | "updatedAt"
>;
