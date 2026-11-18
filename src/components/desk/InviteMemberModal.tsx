import { Button, Form, Input, Modal, Select, Typography, message } from "antd";
import { ASSIGNABLE_ROLES, ROLE_LABEL, type WorkspaceRole } from "@/domain/roles";

export function InviteMemberModal({
  open,
  onCancel,
  onSend,
  onCopyLink,
}: {
  open: boolean;
  onCancel: () => void;
  onSend: (email: string, role: WorkspaceRole) => Promise<void>;
  onCopyLink: (email: string, role: WorkspaceRole) => Promise<string>;
}) {
  const [form] = Form.useForm<{ email: string; role: WorkspaceRole }>();
  return (
    <Modal
      title="邀请成员"
      open={open}
      onCancel={onCancel}
      footer={null}
      destroyOnHidden
      afterOpenChange={(visible) => {
        if (visible) form.setFieldsValue({ email: "", role: "USER" });
      }}
    >
      <Form form={form} layout="vertical" initialValues={{ role: "USER" }}>
        <Form.Item name="email" label="邮箱" rules={[{ required: true, type: "email", message: "请填写有效的邮箱。" }]}>
          <Input placeholder="colleague@example.com" />
        </Form.Item>
        <Form.Item name="role" label="角色">
          <Select options={ASSIGNABLE_ROLES.filter((role) => role !== "OWNER").map((role) => ({ value: role, label: ROLE_LABEL[role] }))} />
        </Form.Item>
        <Typography.Paragraph type="secondary">
          将向该邮箱发送邀请。也可以复制邀请链接发给对方。待接受的邀请不会出现在名单里。
        </Typography.Paragraph>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button
            onClick={async () => {
              const values = await form.validateFields();
              const link = await onCopyLink(values.email, values.role);
              try {
                await navigator.clipboard.writeText(link);
                message.success("邀请链接已复制。");
              } catch {
                message.info(link);
              }
            }}
          >
            复制邀请链接
          </Button>
          <Button onClick={onCancel}>取消</Button>
          <Button
            type="primary"
            onClick={async () => {
              const values = await form.validateFields();
              await onSend(values.email, values.role);
              message.success("邀请已发送。");
              onCancel();
            }}
          >
            发送邀请
          </Button>
        </div>
      </Form>
    </Modal>
  );
}
