const MIN_WHEEL_SPEED = 0.1
const MAX_WHEEL_SPEED = 2
const HORIZONTAL_DOMINANCE_RATIO = 1.6
export const INJECTED_WHEEL_MARKER_SCREEN_X = -987654321
export const INJECTED_WHEEL_MARKER_SCREEN_Y = -987654123

function clampSpeed(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(MIN_WHEEL_SPEED, Math.min(MAX_WHEEL_SPEED, value))
    : 1
}

export function createWebWheelSpeedScript(speed) {
  const safeSpeed = clampSpeed(speed)
  return `
(() => {
  const controllerKey = '__goofOffWheelSpeedController';
  const nextSpeed = ${JSON.stringify(safeSpeed)};
  const injectedWheelMarkerScreenX = ${JSON.stringify(INJECTED_WHEEL_MARKER_SCREEN_X)};
  const injectedWheelMarkerScreenY = ${JSON.stringify(INJECTED_WHEEL_MARKER_SCREEN_Y)};

  function toPixels(delta, mode) {
    if (!Number.isFinite(delta)) return 0;
    if (mode === 1) return delta * 16;
    if (mode === 2) return delta * Math.max(1, window.innerHeight || 1);
    return delta;
  }

  function scrollRange(el, axis) {
    if (!el) return 0;
    if (axis === 'x') return Math.max(0, (el.scrollWidth || 0) - (el.clientWidth || 0));
    return Math.max(0, (el.scrollHeight || 0) - (el.clientHeight || 0));
  }

  function canScrollElement(el, dx, dy) {
    if (!el || el.nodeType !== 1) return false;
    const style = window.getComputedStyle(el);
    const overflowY = style.overflowY || style.overflow || '';
    const overflowX = style.overflowX || style.overflow || '';
    const yAllowed = /auto|scroll|overlay/i.test(overflowY);
    const xAllowed = /auto|scroll|overlay/i.test(overflowX);
    const maxY = scrollRange(el, 'y');
    const maxX = scrollRange(el, 'x');
    if (dy > 0 && yAllowed && el.scrollTop < maxY) return true;
    if (dy < 0 && yAllowed && el.scrollTop > 0) return true;
    if (dx > 0 && xAllowed && el.scrollLeft < maxX) return true;
    if (dx < 0 && xAllowed && el.scrollLeft > 0) return true;
    return false;
  }

  function documentScroller() {
    return document.scrollingElement || document.documentElement || document.body;
  }

  function eventPath(event) {
    if (typeof event.composedPath === 'function') return event.composedPath();
    const path = [];
    let node = event.target;
    while (node) {
      path.push(node);
      node = node.parentNode;
    }
    return path;
  }

  function findScrollTarget(event, dx, dy) {
    for (const node of eventPath(event)) {
      if (canScrollElement(node, dx, dy)) return node;
    }
    return documentScroller();
  }

  function applyScroll(target, dx, dy) {
    const maxX = scrollRange(target, 'x');
    const maxY = scrollRange(target, 'y');
    target.scrollLeft = Math.max(0, Math.min(maxX, (target.scrollLeft || 0) + dx));
    target.scrollTop = Math.max(0, Math.min(maxY, (target.scrollTop || 0) + dy));
  }

  function isMainProcessInjectedWheel(event) {
    return event.screenX === injectedWheelMarkerScreenX && event.screenY === injectedWheelMarkerScreenY;
  }

  function onWheel(event) {
    const controller = window[controllerKey];
    const speed = controller && Number.isFinite(controller.speed) ? controller.speed : 1;
    if (speed === 1) return;
    if (event.defaultPrevented || isMainProcessInjectedWheel(event) || event.cancelable === false) return;
    if (event.ctrlKey || event.shiftKey) return;

    const dx = toPixels(event.deltaX || 0, event.deltaMode || 0);
    const dy = toPixels(event.deltaY || 0, event.deltaMode || 0);
    if (dx === 0 && dy === 0) return;
    if (Math.abs(dx) >= Math.abs(dy) * ${HORIZONTAL_DOMINANCE_RATIO}) return;

    event.preventDefault();
    applyScroll(findScrollTarget(event, dx, dy), dx * speed, dy * speed);
  }

  if (window[controllerKey]) {
    window[controllerKey].speed = nextSpeed;
    return;
  }

  window[controllerKey] = { speed: nextSpeed };
  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
})();
`
}
