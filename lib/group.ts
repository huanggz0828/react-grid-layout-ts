import ReactGridLayout from "./ReactGridLayout";
import { findInArray } from "./utils";
import { forEach, isFunction } from "./lodash-es";

export const RGLMap: Record<string, ReactGridLayout> = {};
const THRESHOLD = 30;

// from sortable
function getWindowScrollingElement() {
  let scrollingElement = document.scrollingElement;

  if (scrollingElement) {
    return scrollingElement;
  } else {
    return document.documentElement;
  }
}

// from sortable
function getCss(
  el: HTMLElement & { currentStyle?: any },
  prop: string,
  val?: CSSStyleDeclaration
) {
  let style = el && el.style;

  if (style) {
    if (val === void 0) {
      if (document.defaultView && document.defaultView.getComputedStyle) {
        val = document.defaultView.getComputedStyle(el, "");
      } else if (el.currentStyle) {
        val = el.currentStyle;
      }

      return prop === void 0 ? val : val?.[prop as any];
    } else {
      if (!(prop in style) && prop.indexOf("webkit") === -1) {
        prop = "-webkit-" + prop;
      }

      style[prop as any] = val + (typeof val === "string" ? "" : "px");
    }
  }
}

// from sortable
function matrix(el: HTMLElement, selfOnly?: boolean) {
  let appliedTransforms = "";
  if (typeof el === "string") {
    appliedTransforms = el;
  } else {
    do {
      let transform = getCss(el, "transform");

      if (transform && transform !== "none") {
        appliedTransforms = transform + " " + appliedTransforms;
      }
      /* jshint boss:true */
    } while (!selfOnly && (el = el.parentNode as HTMLElement));
  }

  const matrixFn =
    window.DOMMatrix ||
    window.WebKitCSSMatrix ||
    window.CSSMatrix ||
    window.MSCSSMatrix;
  /*jshint -W056 */
  return matrixFn && new matrixFn(appliedTransforms);
}

function userAgent(pattern: RegExp) {
  if (typeof window !== "undefined" && window.navigator) {
    return !!(/*@__PURE__*/ navigator.userAgent.match(pattern));
  }
}

const IE11OrLess = userAgent(
  /(?:Trident.*rv[ :]?11\.|msie|iemobile|Windows Phone)/i
);

// from sortable
export /**
 * Returns the "bounding client rect" of given element
 * @param  {HTMLElement} el                       The element whose boundingClientRect is wanted
 * @param  {[Boolean]} relativeToContainingBlock  Whether the rect should be relative to the containing block of (including) the container
 * @param  {[Boolean]} relativeToNonStaticParent  Whether the rect should be relative to the relative parent of (including) the contaienr
 * @param  {[Boolean]} undoScale                  Whether the container's scale() should be undone
 * @param  {[HTMLElement]} container              The parent the element will be placed in
 * @return {Object}                               The boundingClientRect of el, with specified adjustments
 */
function getRect(
  el: HTMLElement,
  relativeToContainingBlock?: boolean,
  relativeToNonStaticParent?: boolean,
  undoScale?: boolean,
  container?: HTMLElement | null
) {
  if (!el.getBoundingClientRect) return;

  let elRect, top, left, bottom, right, height, width;

  if (el.parentNode && el !== getWindowScrollingElement()) {
    elRect = el.getBoundingClientRect();
    top = elRect.top;
    left = elRect.left;
    bottom = elRect.bottom;
    right = elRect.right;
    height = elRect.height;
    width = elRect.width;
  } else {
    top = 0;
    left = 0;
    bottom = window.innerHeight;
    right = window.innerWidth;
    height = window.innerHeight;
    width = window.innerWidth;
  }

  if (relativeToContainingBlock || relativeToNonStaticParent) {
    // Adjust for translate()
    container = container || (el.parentNode as HTMLElement);

    // solves #1123 (see: https://stackoverflow.com/a/37953806/6088312)
    // Not needed on <= IE11
    if (!IE11OrLess) {
      do {
        if (
          container &&
          container.getBoundingClientRect &&
          (getCss(container, "transform") !== "none" ||
            (relativeToNonStaticParent &&
              getCss(container, "position") !== "static"))
        ) {
          let containerRect = container.getBoundingClientRect();

          // Set relative to edges of padding box of container
          top -=
            containerRect.top +
            parseInt(getCss(container, "border-top-width") as string);
          left -=
            containerRect.left +
            parseInt(getCss(container, "border-left-width") as string);
          bottom = top + (elRect?.height || 0);
          right = left + (elRect?.width || 0);

          break;
        }
        /* jshint boss:true */
      } while ((container = container?.parentNode as HTMLElement));
    }
  }

  if (undoScale) {
    // Adjust for scale()
    let elMatrix = matrix(container || el),
      scaleX = elMatrix && elMatrix.a,
      scaleY = elMatrix && elMatrix.d;

    if (elMatrix) {
      top /= scaleY;
      left /= scaleX;

      width /= scaleX;
      height /= scaleY;

      bottom = top + height;
      right = left + width;
    }
  }

  return {
    top: top,
    left: left,
    bottom: bottom,
    right: right,
    width: width,
    height: height
  };
}

export /**
 * Detects nearest empty sortable to X and Y position using emptyInsertThreshold.
 * @param  {Number} x      X position
 * @param  {Number} y      Y position
 * @return {HTMLElement}   Element of the first found nearest Sortable
 */
function detectNearestEmptySortable(x: number, y: number) : ReactGridLayout | undefined {
  let res;
  let distance = Infinity;
  forEach(Object.values(RGLMap), sortable => {
    const el = sortable?.elementRef?.current;
    if (!el) return;

    const rect = getRect(el);
    if (!rect) return;
    const left = rect.left - THRESHOLD,
      right = rect.right + THRESHOLD,
      top = rect.top - THRESHOLD,
      bottom = rect.bottom + THRESHOLD,
      insideHorizontally = x >= left && x <= right,
      insideVertically = y >= top && y <= bottom;

    if (!(insideHorizontally && insideVertically)) {
      return;
    }
    const dis = Math.min(x - left, right - x) + Math.min(y - top, bottom - x);
    if (dis < distance) {
      distance = dis;
      res = sortable;
    }
  });
  return res;
}

// from react-draggable
export function matchesSelector(el: HTMLElement, selector: string): boolean {
  let matchesSelectorFunc;
  if (!matchesSelectorFunc) {
    matchesSelectorFunc = findInArray(
      [
        "matches",
        "webkitMatchesSelector",
        "mozMatchesSelector",
        "msMatchesSelector",
        "oMatchesSelector"
      ],
      function (method: string) {
        // $FlowIgnore: Doesn't think elements are indexable
        return isFunction(el[method as keyof HTMLElement]);
      }
    );
  }

  // Might not be found entirely (not an Element?) - in that case, bail
  // $FlowIgnore: Doesn't think elements are indexable
  if (!isFunction(el[matchesSelectorFunc as keyof HTMLElement])) return false;

  // $FlowIgnore: Doesn't think elements are indexable
  return (el[matchesSelectorFunc as keyof HTMLElement] as Function)(selector);
}
