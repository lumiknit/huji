import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import { TbFillCloud, TbOutlineDeviceFloppy } from "solid-icons/tb";
import toast from "solid-toast";

import type { SyncFile, SyncProvider } from "../lib/sync/interface";
import { unpackBackupName } from "../lib/path";
import {
  type FileSummary,
  deleteLocalFile,
  formatDateTime,
  formatSize,
} from "./file_list";

// ── Types ────────────────────────────────────────────────────────────────────

type DeletePlanGroup = {
  docId: string;
  displayName: string;
  keepLocal: FileSummary | null;
  deleteLocal: FileSummary[];
  keepRemote: SyncFile | null;
  deleteRemote: SyncFile[];
};

// ── Plan computation ─────────────────────────────────────────────────────────

function computePlan(
  localItems: FileSummary[],
  cloudItems: SyncFile[],
): DeletePlanGroup[] {
  const localByDoc = new Map<string, FileSummary[]>();
  for (const item of localItems) {
    if (!item.docId) continue;
    if (!localByDoc.has(item.docId)) localByDoc.set(item.docId, []);
    localByDoc.get(item.docId)!.push(item);
  }

  const remoteByDoc = new Map<string, SyncFile[]>();
  for (const item of cloudItems) {
    const id = unpackBackupName(item.name)?.id;
    if (!id) continue;
    if (!remoteByDoc.has(id)) remoteByDoc.set(id, []);
    remoteByDoc.get(id)!.push(item);
  }

  for (const arr of remoteByDoc.values()) {
    arr.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  }

  const allDocIds = new Set([...localByDoc.keys(), ...remoteByDoc.keys()]);
  const plans: DeletePlanGroup[] = [];

  for (const docId of allDocIds) {
    const locals = localByDoc.get(docId) ?? [];
    const remotes = remoteByDoc.get(docId) ?? [];

    if (locals.length <= 1 && remotes.length <= 1) continue;

    const keepLocal = locals[0] ?? null;
    const deleteLocal = locals.slice(1);
    const keepRemote = remotes[0] ?? null;
    const deleteRemote = remotes.slice(1);

    const displayName =
      keepLocal?.filename ??
      unpackBackupName(keepRemote?.name ?? "")?.title ??
      keepRemote?.name ??
      docId;

    plans.push({
      docId,
      displayName,
      keepLocal,
      deleteLocal,
      keepRemote,
      deleteRemote,
    });
  }

  return plans;
}

// ── Component ────────────────────────────────────────────────────────────────

type DeletePreviewProps = {
  localItems: FileSummary[];
  cloudItems: SyncFile[];
  provider: SyncProvider | null;
  onDone: () => void;
};

const DeletePreview: Component<DeletePreviewProps> = (props) => {
  const [busy, setBusy] = createSignal(false);

  const plan = createMemo(() =>
    computePlan(props.localItems, props.cloudItems),
  );

  const totalDeletes = createMemo(() =>
    plan().reduce(
      (n, g) => n + g.deleteLocal.length + g.deleteRemote.length,
      0,
    ),
  );

  const handleConfirm = async () => {
    const groups = plan();
    const provider = props.provider;
    setBusy(true);
    const p = (async () => {
      for (const g of groups) {
        await Promise.all(g.deleteLocal.map((f) => deleteLocalFile(f.fileId)));
        if (g.deleteRemote.length > 0) {
          if (!provider) throw new Error("No cloud provider connected");
          const token = await provider.ensureToken();
          await Promise.all(
            g.deleteRemote.map((f) => provider.delete(token, f.name)),
          );
        }
      }
      return totalDeletes();
    })();
    toast.promise(p, {
      loading: "Deleting…",
      success: (n) => `Deleted ${n} old version(s)`,
      error: (e) => `Delete failed: ${(e as Error).message}`,
    });
    try {
      await p;
      props.onDone();
    } catch {
      // toast already shown
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Show
        when={plan().length > 0}
        fallback={
          <p>
            <small>No duplicate versions found. Nothing to clean up.</small>
          </p>
        }
      >
        <p class="mb-sm">
          <small>
            Review what will be deleted. The most recent copy of each group is
            kept; older versions are removed.
          </small>
        </p>
        <ul class="files mb-md">
          <For each={plan()}>
            {(group) => (
              <>
                <li class="version-group-header">
                  <span class="file-chevron" />
                  <span class="file-info">
                    <span>{group.displayName}</span>
                  </span>
                </li>

                <Show when={group.keepLocal}>
                  {(item) => (
                    <li class="version-item">
                      <span class="file-chevron" />
                      <span class="file-info">
                        <span>
                          <TbOutlineDeviceFloppy class="icon-middle" />{" "}
                          {item().filename}
                        </span>
                        <small>
                          Keep · Local ·{" "}
                          {formatDateTime(new Date(item().lastUsedAt))}
                        </small>
                      </span>
                    </li>
                  )}
                </Show>

                <For each={group.deleteLocal}>
                  {(item) => (
                    <li class="version-item item-deleted">
                      <span class="file-chevron" />
                      <span class="file-info">
                        <span>
                          <TbOutlineDeviceFloppy class="icon-middle" />{" "}
                          {item.filename}
                        </span>
                        <small class="text-danger">
                          Delete · Local ·{" "}
                          {formatDateTime(new Date(item.lastUsedAt))}
                        </small>
                      </span>
                    </li>
                  )}
                </For>

                <Show when={group.keepRemote}>
                  {(item) => (
                    <li class="version-item">
                      <span class="file-chevron" />
                      <span class="file-info">
                        <span>
                          <TbFillCloud class="file-cloud-icon" /> {item().name}
                        </span>
                        <small>
                          Keep · Cloud · {formatDateTime(item().modifiedAt)}
                          <Show when={item().size !== undefined}>
                            {" · "}
                            {formatSize(item().size!)}
                          </Show>
                        </small>
                      </span>
                    </li>
                  )}
                </Show>

                <For each={group.deleteRemote}>
                  {(item) => (
                    <li class="version-item item-deleted">
                      <span class="file-chevron" />
                      <span class="file-info">
                        <span>
                          <TbFillCloud class="file-cloud-icon" /> {item.name}
                        </span>
                        <small class="text-danger">
                          Delete · Cloud · {formatDateTime(item.modifiedAt)}
                          <Show when={item.size !== undefined}>
                            {" · "}
                            {formatSize(item.size!)}
                          </Show>
                        </small>
                      </span>
                    </li>
                  )}
                </For>
              </>
            )}
          </For>
        </ul>
      </Show>

      <div class="button-row">
        <button onClick={props.onDone} disabled={busy()}>
          Cancel
        </button>
        <Show when={plan().length > 0}>
          <button class="danger" onClick={handleConfirm} disabled={busy()}>
            Delete {totalDeletes()} old version(s)
          </button>
        </Show>
      </div>
    </div>
  );
};

export default DeletePreview;
