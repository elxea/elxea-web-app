import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldSet,
  FieldLegend,
  FieldContent,
} from "./field";
import { Input } from "./input";
import { Checkbox } from "./checkbox";

const meta = {
  title: "02 Elements/Field",
  component: Field,
  tags: ["autodocs"],
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Field>
      <FieldLabel htmlFor="email">Email</FieldLabel>
      <Input id="email" type="email" placeholder="you@example.com" />
      <FieldDescription>We will never share your email.</FieldDescription>
    </Field>
  ),
};

export const WithError: Story = {
  render: () => (
    <Field data-invalid="true">
      <FieldLabel htmlFor="email-err">Email</FieldLabel>
      <Input id="email-err" type="email" aria-invalid="true" />
      <FieldError>Please enter a valid email address.</FieldError>
    </Field>
  ),
};

export const Horizontal: Story = {
  render: () => (
    <Field orientation="horizontal">
      <FieldLabel htmlFor="name-h">Name</FieldLabel>
      <Input id="name-h" placeholder="John Doe" />
    </Field>
  ),
};

export const FieldGroupExample: Story = {
  render: () => (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="first">First Name</FieldLabel>
        <Input id="first" placeholder="John" />
      </Field>
      <Field>
        <FieldLabel htmlFor="last">Last Name</FieldLabel>
        <Input id="last" placeholder="Doe" />
      </Field>
    </FieldGroup>
  ),
};

export const FieldSetExample: Story = {
  render: () => (
    <FieldSet>
      <FieldLegend>Notifications</FieldLegend>
      <FieldDescription>Select which notifications you want to receive.</FieldDescription>
      <Field orientation="horizontal">
        <Checkbox id="email-notif" />
        <FieldContent>
          <FieldLabel htmlFor="email-notif">Email</FieldLabel>
          <FieldDescription>Receive email notifications.</FieldDescription>
        </FieldContent>
      </Field>
      <Field orientation="horizontal">
        <Checkbox id="sms-notif" />
        <FieldContent>
          <FieldLabel htmlFor="sms-notif">SMS</FieldLabel>
          <FieldDescription>Receive SMS notifications.</FieldDescription>
        </FieldContent>
      </Field>
    </FieldSet>
  ),
};
