import { Modal, Select, Typography } from "antd";
import { useEffect, useState } from "react";
import type { Project, WorkspaceMember } from "@/domain/types";

export function AddProjectMemberModal({
  open,
  project,
  members,
  onCancel,
  onSave,
}: {
  open: boolean;
  project: Project | null;
  members: WorkspaceMember[];
  onCancel: () => void;
  onSave: (memberIds: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setSelected(project?.memberIds ?? []);
  }, [open, project]);

  return (
    <Modal
      destroyOnHidden
      title={project ? `添加成员 · ${project.name}` : "添加成员"}
      open={open}
      okText="保存"
      cancelText="取消"
      confirmLoading={busy}
      onCancel={onCancel}
      onOk={async () => {
        setBusy(true);
        try {
          await onSave(selected);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Typography.Paragraph type="secondary">只能从本工作区成员里添加。邀请新同事请到员工管理。</Typography.Paragraph>
      <Select
        mode="multiple"
        style={{ width: "100%" }}
        placeholder="选择成员"
        value={selected}
        optionFilterProp="label"
        options={members
          .filter((member) => member.active)
          .map((member) => ({ value: member.accountId, label: `${member.name}${member.email ? `（${member.email}）` : ""}` }))}
        onChange={setSelected}
      />
    </Modal>
  );
}
