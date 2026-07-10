import { type Component, createSignal, For, Show } from "solid-js";
import { TbOutlineArrowBackUp, TbOutlineTrash } from "solid-icons/tb";
import toast from "solid-toast";
import { aconfirm } from "./CommonDialog";
import {
  type FileSummary,
  deleteLocalFile,
  setFileDeleted,
  formatDateTime,
} from "./file_list";

type TrashListProps = {
  items: FileSummary[];
  onRefetch: () => void;
};

const TrashList: Component<TrashListProps> = (props) => {
  const [emptying, setEmptying] = createSignal(false);

  const handleRestore = async (fileId: string) => {
    await setFileDeleted(fileId, false);
    props.onRefetch();
    toast.success("Restored");
  };

  const handleDeleteForever = async (fileId: string) => {
    if (
      !(await aconfirm("Permanently delete this file? This can't be undone."))
    )
      return;
    await deleteLocalFile(fileId);
    props.onRefetch();
    toast.success("Deleted permanently");
  };

  const handleEmptyTrash = async () => {
    const items = props.items;
    if (items.length === 0) return;
    if (
      !(await aconfirm(
        `Permanently delete all ${items.length} file(s) in Trash? This can't be undone.`,
      ))
    )
      return;
    setEmptying(true);
    try {
      await Promise.all(items.map((item) => deleteLocalFile(item.fileId)));
      props.onRefetch();
      toast.success("Trash emptied");
    } finally {
      setEmptying(false);
    }
  };

  return (
    <Show
      when={props.items.length > 0}
      fallback={
        <p>
          <small>Trash is empty.</small>
        </p>
      }
    >
      <div class="button-row mb-md">
        <button
          class="danger"
          onClick={() => void handleEmptyTrash()}
          disabled={emptying()}
        >
          <TbOutlineTrash /> Empty Trash ({props.items.length})
        </button>
      </div>
      <ul class="files">
        <For each={props.items}>
          {(item) => (
            <li>
              <span class="file-info">
                <span>{item.filename}</span>
                <small>
                  Deleted {formatDateTime(new Date(item.deletedAt!))}
                </small>
              </span>
              <div class="button-row">
                <button
                  title="Restore"
                  onClick={() => void handleRestore(item.fileId)}
                >
                  <TbOutlineArrowBackUp /> Restore
                </button>
                <button
                  class="danger"
                  title="Delete forever"
                  onClick={() => void handleDeleteForever(item.fileId)}
                >
                  <TbOutlineTrash /> Delete forever
                </button>
              </div>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
};

export default TrashList;
