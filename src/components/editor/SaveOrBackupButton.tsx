import { type Component, Show } from "solid-js";
import { TbOutlineDeviceFloppy, TbOutlineCloudUpload } from "solid-icons/tb";

type Props = {
  status: () => string;
  onSave: () => void;
  onBackup: () => void;
  canBackup: () => boolean;
};

const SaveOrBackupButton: Component<Props> = (props) => {
  const isSaved = () => props.status() === "saved";
  const handleClick = () => {
    if (isSaved()) {
      props.onBackup();
    } else {
      props.onSave();
    }
  };
  return (
    <button
      class={isSaved() ? undefined : "primary"}
      disabled={isSaved() ? !props.canBackup() : props.status() === "saving"}
      onClick={handleClick}
      title={isSaved() ? "Backup to cloud" : "Save"}
    >
      <Show when={isSaved()} fallback={<TbOutlineDeviceFloppy />}>
        <TbOutlineCloudUpload />
      </Show>
    </button>
  );
};

export default SaveOrBackupButton;
