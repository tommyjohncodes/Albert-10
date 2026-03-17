import { Sandbox } from "@e2b/code-interpreter";
import { Prisma, SandboxState } from "@/generated/prisma";

import { prisma } from "@/lib/db";
import { SANDBOX_RUN_TIMEOUT, SANDBOX_TIMEOUT } from "@/inngest/types";
import { getSandbox } from "@/inngest/utils";

import { SANDBOX_PREVIEW_PORT } from "./sandbox-preview";
import { getActiveSandboxCutoff } from "./sandbox-activity";

export const MAX_ACTIVE_SANDBOXES_PER_USER = 2;

const USER_LOCK_PREFIX = "sandbox-user:";
const TX_OPTIONS = {
  maxWait: 60_000,
  timeout: 120_000,
} satisfies Parameters<typeof prisma.$transaction>[1];

const getSandboxTemplateName = () =>
  process.env.E2B_TEMPLATE_NAME ??
  process.env.E2B_TEMPLATE ??
  "vibe-nextjs-test-2";

type TxClient = Prisma.TransactionClient;

interface EnsureProjectSandboxOptions {
  projectId: string;
  userId: string;
  orgId?: string | null;
  projectSandboxId?: string | null;
  inferredSandboxId?: string | null;
  hydrateFiles?: Record<string, string>;
}

interface ManagedSandboxResult {
  sandboxId: string;
  sandboxUrl: string;
  created: boolean;
}

const isNotFoundError = (error: unknown) =>
  error instanceof Error && /not found/i.test(error.message);

const buildCandidateIds = (
  projectSandboxId: string | null | undefined,
  inferredSandboxId: string | null | undefined,
  trackedInstances: Array<{ sandboxId: string }>,
) => {
  const candidateIds = [
    projectSandboxId ?? null,
    inferredSandboxId ?? null,
    ...trackedInstances.map((instance) => instance.sandboxId),
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(candidateIds));
};

const withUserSandboxLock = async <T>(
  userId: string,
  callback: (tx: TxClient) => Promise<T>,
) =>
  prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${USER_LOCK_PREFIX}${userId}`}))`;
    return callback(tx);
  }, TX_OPTIONS);

const markSandboxTerminated = async (
  tx: TxClient,
  sandboxId: string,
  state: SandboxState = SandboxState.TERMINATED,
) => {
  const timestamp = new Date();

  await tx.sandboxInstance.updateMany({
    where: {
      sandboxId,
      state: {
        not: SandboxState.TERMINATED,
      },
    },
    data: {
      state,
      terminatedAt: timestamp,
    },
  });

  await tx.project.updateMany({
    where: { sandboxId },
    data: {
      sandboxId: null,
      sandboxUpdatedAt: timestamp,
    },
  });
};

const hydrateSandboxInstancesFromProjects = async (
  tx: TxClient,
  userId: string,
) => {
  const projects = await tx.project.findMany({
    where: {
      userId,
      sandboxId: { not: null },
    },
    select: {
      id: true,
      sandboxId: true,
      orgId: true,
      sandboxUpdatedAt: true,
      updatedAt: true,
    },
  });

  if (projects.length === 0) {
    return;
  }

  const sandboxIds = projects
    .map((project) => project.sandboxId)
    .filter((value): value is string => Boolean(value));

  const existingInstances = await tx.sandboxInstance.findMany({
    where: {
      sandboxId: {
        in: sandboxIds,
      },
    },
    select: {
      sandboxId: true,
      lastActiveAt: true,
    },
  });

  const existingMap = new Map(
    existingInstances.map((instance) => [instance.sandboxId, instance]),
  );

  await Promise.all(
    projects.map((project) => {
      if (!project.sandboxId) return Promise.resolve();
      const existing = existingMap.get(project.sandboxId);
      const candidateLastActiveAt =
        project.sandboxUpdatedAt ?? project.updatedAt ?? new Date();
      const lastActiveAt =
        existing && existing.lastActiveAt > candidateLastActiveAt
          ? existing.lastActiveAt
          : candidateLastActiveAt;

      return tx.sandboxInstance.upsert({
        where: {
          sandboxId: project.sandboxId,
        },
        update: {
          projectId: project.id,
          userId,
          orgId: project.orgId ?? null,
          lastActiveAt,
          state: SandboxState.RUNNING,
          terminatedAt: null,
        },
        create: {
          sandboxId: project.sandboxId,
          sandboxUrl: null,
          state: SandboxState.RUNNING,
          projectId: project.id,
          userId,
          orgId: project.orgId ?? null,
          lastActiveAt,
        },
      });
    }),
  );
};

const upsertRunningSandbox = async (
  tx: TxClient,
  params: {
    sandboxId: string;
    sandboxUrl: string;
    projectId: string;
    userId: string;
    orgId?: string | null;
  },
) => {
  const timestamp = new Date();

  await tx.sandboxInstance.upsert({
    where: {
      sandboxId: params.sandboxId,
    },
    update: {
      sandboxUrl: params.sandboxUrl,
      state: SandboxState.RUNNING,
      projectId: params.projectId,
      userId: params.userId,
      orgId: params.orgId ?? null,
      lastActiveAt: timestamp,
      terminatedAt: null,
    },
    create: {
      sandboxId: params.sandboxId,
      sandboxUrl: params.sandboxUrl,
      state: SandboxState.RUNNING,
      projectId: params.projectId,
      userId: params.userId,
      orgId: params.orgId ?? null,
      lastActiveAt: timestamp,
    },
  });

  await tx.project.update({
    where: { id: params.projectId },
    data: {
      sandboxId: params.sandboxId,
      sandboxUpdatedAt: timestamp,
    },
  });
};

const evictOverflowSandboxes = async (
  tx: TxClient,
  userId: string,
  keepSandboxIds: string[],
  additionalSlotsNeeded = 0,
) => {
  const cutoff = getActiveSandboxCutoff();
  const activeSandboxes = await tx.sandboxInstance.findMany({
    where: {
      userId,
      state: SandboxState.RUNNING,
      lastActiveAt: {
        gte: cutoff,
      },
    },
    orderBy: [
      { lastActiveAt: "asc" },
      { createdAt: "asc" },
    ],
  });

  const activeSandboxIds = activeSandboxes.map((instance) => instance.sandboxId);
  const keepIds = new Set(keepSandboxIds);
  const desiredActiveCount =
    new Set([...activeSandboxIds, ...keepIds]).size + additionalSlotsNeeded;
  const overflowCount = Math.max(0, desiredActiveCount - MAX_ACTIVE_SANDBOXES_PER_USER);

  if (overflowCount === 0) {
    return;
  }

  const victims = activeSandboxes.filter(
    (instance) => !keepIds.has(instance.sandboxId),
  ).slice(0, overflowCount);

  for (const victim of victims) {
    try {
      await Sandbox.kill(victim.sandboxId);
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }

    await markSandboxTerminated(tx, victim.sandboxId);
  }
};

const tryConnectTrackedSandbox = async (
  tx: TxClient,
  candidateIds: string[],
  params: {
    projectId: string;
    userId: string;
    orgId?: string | null;
  },
) => {
  for (const candidateId of candidateIds) {
    try {
      const sandbox = await getSandbox(candidateId, SANDBOX_RUN_TIMEOUT);
      const sandboxUrl = `https://${sandbox.getHost(SANDBOX_PREVIEW_PORT)}`;

      await evictOverflowSandboxes(tx, params.userId, [candidateId]);
      await upsertRunningSandbox(tx, {
        sandboxId: candidateId,
        sandboxUrl,
        projectId: params.projectId,
        userId: params.userId,
        orgId: params.orgId ?? null,
      });

      return {
        sandboxId: candidateId,
        sandboxUrl,
        created: false,
      } satisfies ManagedSandboxResult;
    } catch (error) {
      await markSandboxTerminated(
        tx,
        candidateId,
        isNotFoundError(error) ? SandboxState.TERMINATED : SandboxState.FAILED,
      );
    }
  }

  return null;
};

const createSandbox = async (
  tx: TxClient,
  params: {
    projectId: string;
    userId: string;
    orgId?: string | null;
    hydrateFiles?: Record<string, string>;
  },
) => {
  await evictOverflowSandboxes(tx, params.userId, [], 1);

  const templateName = getSandboxTemplateName();
  let sandbox;
  try {
    sandbox = await Sandbox.betaCreate(templateName, {
      timeoutMs: SANDBOX_RUN_TIMEOUT,
      lifecycle: { onTimeout: "pause" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(
      `Failed to create sandbox using template "${templateName}": ${message}`,
    );
  }

  if (params.hydrateFiles) {
    for (const [path, content] of Object.entries(params.hydrateFiles)) {
      await sandbox.files.write(path, content);
    }
  }

  const sandboxUrl = `https://${sandbox.getHost(SANDBOX_PREVIEW_PORT)}`;

  await upsertRunningSandbox(tx, {
    sandboxId: sandbox.sandboxId,
    sandboxUrl,
    projectId: params.projectId,
    userId: params.userId,
    orgId: params.orgId ?? null,
  });

  await sandbox.setTimeout(SANDBOX_TIMEOUT);

  return {
    sandboxId: sandbox.sandboxId,
    sandboxUrl,
    created: true,
  } satisfies ManagedSandboxResult;
};

export async function ensureProjectSandbox(
  options: EnsureProjectSandboxOptions,
) {
  return withUserSandboxLock(options.userId, async (tx) => {
    await hydrateSandboxInstancesFromProjects(tx, options.userId);

    const trackedInstances = await tx.sandboxInstance.findMany({
      where: {
        projectId: options.projectId,
        state: {
          not: SandboxState.TERMINATED,
        },
      },
      orderBy: [
        { lastActiveAt: "desc" },
        { createdAt: "desc" },
      ],
    });

    const candidateIds = buildCandidateIds(
      options.projectSandboxId,
      options.inferredSandboxId,
      trackedInstances,
    );

    const existingSandbox = await tryConnectTrackedSandbox(tx, candidateIds, {
      projectId: options.projectId,
      userId: options.userId,
      orgId: options.orgId ?? null,
    });

    if (existingSandbox) {
      return existingSandbox;
    }

    return createSandbox(tx, {
      projectId: options.projectId,
      userId: options.userId,
      orgId: options.orgId ?? null,
      hydrateFiles: options.hydrateFiles,
    });
  });
}

export async function touchProjectSandbox(params: {
  projectId: string;
  sandboxId: string;
  sandboxUrl?: string | null;
}) {
  const timestamp = new Date();

  const project = await prisma.project.findUnique({
    where: { id: params.projectId },
    select: {
      userId: true,
      orgId: true,
    },
  });

  if (!project) {
    throw new Error(`Project ${params.projectId} not found for sandbox touch.`);
  }

  await withUserSandboxLock(project.userId, async (tx) => {
    await tx.project.update({
      where: { id: params.projectId },
      data: {
        sandboxId: params.sandboxId,
        sandboxUpdatedAt: timestamp,
      },
    });

    await evictOverflowSandboxes(tx, project.userId, [params.sandboxId]);

    await tx.sandboxInstance.upsert({
      where: {
        sandboxId: params.sandboxId,
      },
      update: {
        state: SandboxState.RUNNING,
        sandboxUrl: params.sandboxUrl ?? undefined,
        lastActiveAt: timestamp,
        terminatedAt: null,
        projectId: params.projectId,
        userId: project.userId,
        orgId: project.orgId ?? null,
      },
      create: {
        sandboxId: params.sandboxId,
        sandboxUrl: params.sandboxUrl ?? null,
        state: SandboxState.RUNNING,
        projectId: params.projectId,
        userId: project.userId,
        orgId: project.orgId ?? null,
        lastActiveAt: timestamp,
      },
    });
  });
}

export async function terminateProjectSandboxes(projectId: string) {
  const instances = await prisma.sandboxInstance.findMany({
    where: {
      projectId,
      state: SandboxState.RUNNING,
    },
    select: {
      sandboxId: true,
    },
  });

  for (const instance of instances) {
    try {
      await Sandbox.kill(instance.sandboxId);
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }

  await prisma.sandboxInstance.updateMany({
    where: {
      projectId,
      state: SandboxState.RUNNING,
    },
    data: {
      state: SandboxState.TERMINATED,
      terminatedAt: new Date(),
    },
  });
}
