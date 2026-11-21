export class TransitionRegistry {
  constructor() {
    this.transitions = new Map();
  }

  key(entityType, action) {
    return `${entityType}:${action}`;
  }

  register(spec) {
    const key = this.key(spec.entityType, spec.action);
    if (this.transitions.has(key)) {
      throw new Error(`Transition already registered: ${key}`);
    }
    this.transitions.set(key, spec);
    return spec;
  }

  get(entityType, action) {
    return this.transitions.get(this.key(entityType, action)) || null;
  }
}

export const defaultTransitionRegistry = new TransitionRegistry();
