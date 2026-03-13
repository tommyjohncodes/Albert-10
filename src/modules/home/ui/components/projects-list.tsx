"use client";

import Link from "next/link";
import Image from "next/image";
import { useUser } from "@clerk/nextjs";
import { formatDistanceToNow } from "date-fns";
import { Loader2Icon, Trash2Icon } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import type { Project } from "@/generated/prisma";

interface ProjectCardProps {
  project: Project;
  isDeleting: boolean;
  onDelete: (projectId: string) => void;
}

const ProjectCard = ({ project, isDeleting, onDelete }: ProjectCardProps) => {
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  useEffect(() => {
    if (!open) {
      setConfirmName("");
    }
  }, [open]);

  const isMatch = confirmName.trim() === project.name;

  return (
    <div className="relative flex items-start justify-between gap-4 rounded-lg border bg-white dark:bg-sidebar p-4">
      <Link
        href={`/projects/${project.id}`}
        className="flex min-w-0 flex-1 items-center gap-x-4"
      >
        <Image
          src="/albert-logo.png"
          alt="Vibe"
          width={32}
          height={32}
          className="object-contain"
        />
        <div className="min-w-0 flex flex-col">
          <h3 className="truncate font-medium">
            {project.displayTitle ?? project.name}
          </h3>
          <p className="text-sm text-muted-foreground">
            {formatDistanceToNow(project.updatedAt, {
              addSuffix: true,
            })}
          </p>
        </div>
      </Link>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0"
            aria-label="Delete project"
            disabled={isDeleting}
          >
            <Trash2Icon className="size-4" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this project and all its messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Type <span className="font-mono font-semibold">{project.name}</span> to confirm.
            </p>
            <Input
              value={confirmName}
              onChange={(event) => setConfirmName(event.target.value)}
              placeholder={project.name}
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                onClick={() => onDelete(project.id)}
                disabled={!isMatch || isDeleting}
              >
                {isDeleting ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  "Delete"
                )}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export const ProjectsList = () => {
  const trpc = useTRPC();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { data: projects } = useQuery(trpc.projects.getMany.queryOptions());
  const deleteProject = useMutation(
    trpc.projects.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries(trpc.projects.getMany.queryOptions());
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  const handleDelete = (projectId: string) => {
    setDeletingId(projectId);
    deleteProject.mutate(
      { id: projectId },
      {
        onSettled: () => setDeletingId(null),
      },
    );
  };

  if (!user) return null;

  return (
    <div className="w-full bg-white dark:bg-sidebar rounded-xl p-8 border flex flex-col gap-y-6 sm:gap-y-4">
      <h2 className="text-2xl font-semibold">
        {user?.firstName}&apos;s Projects
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {projects?.length === 0 && (
          <div className="col-span-full text-center">
            <p className="text-sm text-muted-foreground">
              No projects found
            </p>
          </div>
        )}
        {projects?.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            isDeleting={deleteProject.isPending && deletingId === project.id}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  );
};
