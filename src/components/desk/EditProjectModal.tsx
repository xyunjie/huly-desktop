import { Button, Form, Input, Modal, Popconfirm, Select, Typography } from "antd";
import { useEffect } from "react";
import type { Person, Project, ProjectPatch } from "@/domain/types";

export function EditProjectModal({
  open,
  project,
  people,
  onCancel,
  onSave,
}: {
  open: boolean;
  project: Project | null;
  people: Person[];
  onCancel: () => void;
  onSave: (patch: ProjectPatch) => Promise<void>;
}) {
  const [form] = Form.useForm<{ name: string; description: string; defaultAssigneeId: string | null }>();
  useEffect(() => {
    if (open && project) {
      form.setFieldsValue({
        name: project.name,
        description: project.description ?? "",
        defaultAssigneeId: project.defaultAssigneeId ?? null,
      });
    }
  }, [open, project, form]);

  return (
    <Modal
      destroyOnHidden
      title={project ? `编辑项目 · ${project.identifier}` : "编辑项目"}
      open={open}
      okText="保存"
      cancelText="取消"
      onCancel={onCancel}
      onOk={async () => {
        const values = await form.validateFields();
        await onSave({
          name: values.name,
          description: values.description,
          defaultAssigneeId: values.defaultAssigneeId,
        });
      }}
    >
      <Form form={form} layout="vertical">
        <Form.Item label="代号">
          <Input value={project?.identifier} disabled />
        </Form.Item>
        <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写项目名称。" }]}>
          <Input />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item name="defaultAssigneeId" label="负责人">
          <Select allowClear placeholder="未设置" options={people.map((person) => ({ value: person.id, label: person.name }))} />
        </Form.Item>
        <Form.Item label="归档">
          <Popconfirm
            title="确认归档这个项目？归档后它会从默认列表中隐藏。"
            okText="归档"
            cancelText="取消"
            onConfirm={async () => {
              const values = await form.validateFields();
              await onSave({
                name: values.name,
                description: values.description,
                defaultAssigneeId: values.defaultAssigneeId,
                archived: true,
              });
            }}
          >
            <Button danger data-testid="archive-project">
              归档此项目
            </Button>
          </Popconfirm>
        </Form.Item>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          代号影响任务编号，这一期不允许修改。归档需要单独确认。
        </Typography.Paragraph>
      </Form>
    </Modal>
  );
}
