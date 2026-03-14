import { z } from "zod";
import { toast } from "sonner";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import TextareaAutosize from "react-textarea-autosize";
import { ArrowUpIcon, CrosshairIcon, Loader2Icon, XIcon } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { Form, FormField } from "@/components/ui/form";
import { Hint } from "@/components/hint";
import { useElementPicker } from "./element-picker-context";

interface Props {
  projectId: string;
};

const formSchema = z.object({
  value: z.string()
    .min(1, { message: "Value is required" })
    .max(10000, { message: "Value is too long" }),
})

export const MessageForm = ({ projectId }: Props) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const {
    isPicking,
    selectedElement,
    startPicking,
    stopPicking,
    clearSelection,
  } = useElementPicker();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      value: "",
    },
  });
  
  const createMessage = useMutation(trpc.messages.create.mutationOptions({
    onSuccess: () => {
      form.reset();
      clearSelection();
      queryClient.invalidateQueries(
        trpc.messages.getMany.queryOptions({ projectId }),
      );
    },
    onError: (error) => {
      toast.error(error.message);
    },
  }));
  
  const buildElementContext = () => {
    if (!selectedElement) return "";
    const lines = ["Target element (live picker):"];
    if (selectedElement.label) {
      lines.push(`Label: ${selectedElement.label}`);
    }
    if (selectedElement.selector) {
      lines.push(`Selector: ${selectedElement.selector}`);
    }
    if (selectedElement.text) {
      const trimmed =
        selectedElement.text.length > 160
          ? `${selectedElement.text.slice(0, 157)}...`
          : selectedElement.text;
      lines.push(`Text: ${trimmed}`);
    }
    return lines.join("\n");
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const elementContext = buildElementContext();
    const value = elementContext
      ? `${values.value}\n\n${elementContext}`
      : values.value;
    await createMessage.mutateAsync({
      value,
      projectId,
    });
  };
  
  const [isFocused, setIsFocused] = useState(false);
  const isPending = createMessage.isPending;
  const isButtonDisabled = isPending || !form.formState.isValid;
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn(
          "relative border p-4 pt-1 rounded-xl bg-sidebar dark:bg-sidebar transition-all",
          isFocused && "shadow-xs",
        )}
      >
        {selectedElement && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <div className="flex items-center gap-2 rounded-full border bg-muted/60 px-3 py-1 text-xs font-medium">
              <span className="max-w-[240px] truncate">
                Target: {selectedElement.label}
              </span>
              <button
                type="button"
                onClick={clearSelection}
                className="rounded-full p-0.5 hover:bg-muted"
                aria-label="Clear selected element"
              >
                <XIcon className="size-3" />
              </button>
            </div>
          </div>
        )}
        <FormField
          control={form.control}
          name="value"
          render={({ field }) => (
            <TextareaAutosize
              {...field}
              disabled={isPending}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              minRows={2}
              maxRows={8}
              className="pt-4 resize-none border-none w-full outline-none bg-transparent"
              placeholder="What would you like to build?"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  form.handleSubmit(onSubmit)(e);
                }
              }}
            />
          )}
        />
        <div className="flex flex-wrap gap-2 items-end justify-between pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <Hint text="Pick an element from the live preview" side="top" align="start">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={isPicking ? stopPicking : startPicking}
                className={cn(
                  "gap-2",
                  isPicking && "border-primary text-primary"
                )}
              >
                <CrosshairIcon className="size-4" />
                {isPicking ? "Picking…" : "Pick element"}
              </Button>
            </Hint>
            <div className="text-[10px] text-muted-foreground font-mono">
              <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                <span>&#8984;</span>Enter
              </kbd>
              &nbsp;to submit
            </div>
          </div>
          <Button
            disabled={isButtonDisabled}
            className={cn(
              "size-8 rounded-full",
              isButtonDisabled && "bg-muted-foreground border"
            )}
          >
            {isPending ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <ArrowUpIcon />
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
};
