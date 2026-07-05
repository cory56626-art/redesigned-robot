/**
 * No-op stub of `@minecraft/server-ui` for the load-time smoke test.
 * Chainable builders that resolve to a canceled form when shown.
 */
class Chainable {
  title() {
    return this;
  }
  body() {
    return this;
  }
  button() {
    return this;
  }
  label() {
    return this;
  }
  textField() {
    return this;
  }
  toggle() {
    return this;
  }
  slider() {
    return this;
  }
  dropdown() {
    return this;
  }
  show() {
    return Promise.resolve({ canceled: true });
  }
}

export class ActionFormData extends Chainable {}
export class ModalFormData extends Chainable {}
export class MessageFormData extends Chainable {}
export const FormCancelationReason = { UserBusy: "UserBusy", UserClosed: "UserClosed" };
