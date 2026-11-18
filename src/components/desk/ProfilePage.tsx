import { Avatar, Button, Form, Input, Space, Typography, message } from "antd";
import { PageTitle } from "./PageTitle";
import { useEffect } from "react";
import { nameInitial, namePartsFromDisplay } from "@/data/huly/mapping";
import { displayPersonName, storedPersonName } from "@/data/huly/mapping";
import { avatarColor } from "@/domain/format";
import { ROLE_LABEL } from "@/domain/roles";
import type { Session } from "@/domain/types";

export function ProfilePage({
  session,
  saving,
  onSaveName,
}: {
  session: Session;
  saving?: boolean;
  onSaveName: (firstName: string, lastName: string) => Promise<void>;
}) {
  const [form] = Form.useForm<{ last: string; first: string }>();
  useEffect(() => {
    const parts = namePartsFromDisplay(session.userName);
    form.setFieldsValue({ last: parts.last, first: parts.first });
  }, [session.userName, form]);
  const last = Form.useWatch("last", form) ?? "";
  const first = Form.useWatch("first", form) ?? "";
  const preview = displayPersonName(storedPersonName(first, last)) || session.userName;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageTitle>个人中心</PageTitle>
      <div style={{ padding: "24px 20px", maxWidth: 480, display: "grid", gap: 16 }}>
        <Space size={16} align="start">
          <Avatar size={48} style={{ background: avatarColor(session.userId ?? session.userName), fontSize: 20 }}>
            {nameInitial(preview)}
          </Avatar>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{preview}</div>
            <Typography.Text type="secondary">{session.email || "—"}</Typography.Text>
          </div>
        </Space>
        <div>
          <Typography.Text type="secondary">工作区　</Typography.Text>
          {session.workspaceName}
        </div>
        <div>
          <Typography.Text type="secondary">角色　</Typography.Text>
          {ROLE_LABEL[session.role]}
        </div>
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            try {
              await onSaveName(values.first, values.last);
              message.success("姓名已更新。");
            } catch (reason) {
              message.error(reason instanceof Error ? reason.message : "没有保存成功。");
            }
          }}
        >
          <Form.Item name="last" label="姓">
            <Input placeholder="姓" />
          </Form.Item>
          <Form.Item name="first" label="名">
            <Input placeholder="名" />
          </Form.Item>
          <Typography.Paragraph type="secondary">预览：{preview}。中文按「姓+名」显示，西文按名在前、姓在后。</Typography.Paragraph>
          <Button type="primary" htmlType="submit" loading={saving} data-testid="save-profile">
            保存姓名
          </Button>
        </Form>
      </div>
    </div>
  );
}
