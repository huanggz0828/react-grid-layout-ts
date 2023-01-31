// @flow
import React from "react";
import { includes } from "./lodash-es";
import PropTypes from "prop-types";
import { DraggableCore } from "react-draggable";
import { Resizable, ResizeCallbackData } from "react-resizable";
import {
  Bounded,
  LayoutItem,
  ResizeHandleAxis,
  fastPositionEqual,
  perc,
  setTopLeft,
  setTransform
} from "./utils";
import {
  calcGridItemPosition,
  calcXY,
  calcWH,
  clamp,
  calcGridItemWHPx,
  calcGridColWidth
} from "./calculateUtils";
import {
  resizeHandleAxesType,
  resizeHandleType
} from "./ReactGridLayoutPropTypes";
import clsx from "clsx";

import type {
  ReactDraggableCallbackData,
  GridDragEvent,
  GridResizeEvent,
  DroppingPosition,
  Position
} from "./utils";

import type { PositionParams } from "./calculateUtils";
import type { ResizeHandle } from "./ReactGridLayoutPropTypes";
import { detectNearestEmptySortable, matchesSelector } from "./group";
import ReactGridLayout from "./ReactGridLayout";

const DraggableCoreComp: any = DraggableCore;

type PartialPosition = { top: number; left: number };
type GridItemCallback<Data extends GridDragEvent | GridResizeEvent> = (
  i: string,
  w: number,
  h: number,
  Data: Data
) => void;

type State = {
  resizing?: { width: number; height: number };
  dragging?: { top: number; left: number };
  className: string;
};

type Props = {
  children: React.ReactElement<any>;
  cols: number;
  containerWidth: number;
  margin: [number, number];
  containerPadding: [number, number];
  rowHeight: number;
  maxRows: number;
  isDraggable: boolean;
  isResizable: boolean;
  isBounded?: Bounded[];
  static?: boolean;
  shuttle?: boolean;
  useCSSTransforms?: boolean;
  usePercentages?: boolean;
  transformScale: number;
  droppingPosition?: DroppingPosition;
  groupId?: string;
  parentRef?: React.RefObject<HTMLDivElement>;
  mockDragItem?: LayoutItem;

  className: string;
  style?: Object;
  // Draggability
  cancel: string;
  handle: string;

  x: number;
  y: number;
  w: number;
  h: number;

  minW: number;
  maxW: number;
  minH: number;
  maxH: number;
  i: string;

  resizeHandles?: ResizeHandleAxis[];
  resizeHandle?: ResizeHandle;

  clearMockDropItem?: () => void;
  onDrag?: GridItemCallback<GridDragEvent>;
  onDragStart?: GridItemCallback<GridDragEvent>;
  onDragStop?: GridItemCallback<GridDragEvent>;
  onDragCancel?: (
    i: string,
    x: number,
    y: number,
    nearest: any,
    e: React.DragEvent & { offsetX: number; offsetY: number }
  ) => void;
  onResize?: GridItemCallback<GridResizeEvent>;
  onResizeStart?: GridItemCallback<GridResizeEvent>;
  onResizeStop?: GridItemCallback<GridResizeEvent>;
};

type DefaultProps = {
  className: string;
  cancel: string;
  handle: string;
  minH: number;
  minW: number;
  maxH: number;
  maxW: number;
  transformScale: number;
};

/**
 * An individual item within a ReactGridLayout.
 */
export default class GridItem extends React.Component<Props, State> {
  static propTypes = {
    // Children must be only a single element
    children: PropTypes.element,

    // General grid attributes
    cols: PropTypes.number.isRequired,
    containerWidth: PropTypes.number.isRequired,
    rowHeight: PropTypes.number.isRequired,
    margin: PropTypes.array.isRequired,
    maxRows: PropTypes.number.isRequired,
    containerPadding: PropTypes.array.isRequired,

    // These are all in grid units
    x: PropTypes.number.isRequired,
    y: PropTypes.number.isRequired,
    w: PropTypes.number.isRequired,
    h: PropTypes.number.isRequired,

    // All optional
    minW: function (props: Props, propName: string) {
      const value = props[propName as keyof Props];
      if (typeof value !== "number") return new Error("minWidth not Number");
      if (value > props.w || value > props.maxW)
        return new Error("minWidth larger than item width/maxWidth");
    },

    maxW: function (props: Props, propName: string) {
      const value = props[propName as keyof Props];
      if (typeof value !== "number") return new Error("maxWidth not Number");
      if (value < props.w || value < props.minW)
        return new Error("maxWidth smaller than item width/minWidth");
    },

    minH: function (props: Props, propName: string) {
      const value = props[propName as keyof Props];
      if (typeof value !== "number") return new Error("minHeight not Number");
      if (value > props.h || value > props.maxH)
        return new Error("minHeight larger than item height/maxHeight");
    },

    maxH: function (props: Props, propName: string) {
      const value = props[propName as keyof Props];
      if (typeof value !== "number") return new Error("maxHeight not Number");
      if (value < props.h || value < props.minH)
        return new Error("maxHeight smaller than item height/minHeight");
    },

    // ID is nice to have for callbacks
    i: PropTypes.string.isRequired,

    // Resize handle options
    resizeHandles: resizeHandleAxesType,
    resizeHandle: resizeHandleType,

    // Functions
    onDragStop: PropTypes.func,
    onDragStart: PropTypes.func,
    onDrag: PropTypes.func,
    onResizeStop: PropTypes.func,
    onResizeStart: PropTypes.func,
    onResize: PropTypes.func,

    // Flags
    isDraggable: PropTypes.bool.isRequired,
    isResizable: PropTypes.bool.isRequired,
    isBounded: PropTypes.bool.isRequired,
    static: PropTypes.bool,

    // Use CSS transforms instead of top/left
    useCSSTransforms: PropTypes.bool.isRequired,
    transformScale: PropTypes.number,

    // Others
    className: PropTypes.string,
    // Selector for draggable handle
    handle: PropTypes.string,
    // Selector for draggable cancel (see react-draggable)
    cancel: PropTypes.string,
    // Current position of a dropping element
    droppingPosition: PropTypes.shape({
      e: PropTypes.object.isRequired,
      left: PropTypes.number.isRequired,
      top: PropTypes.number.isRequired
    })
  };

  static defaultProps: DefaultProps = {
    className: "",
    cancel: "",
    handle: "",
    minH: 1,
    minW: 1,
    maxH: Infinity,
    maxW: Infinity,
    transformScale: 1
  };

  state: State = {
    className: ""
  };

  elementRef = React.createRef<HTMLDivElement>();

  shouldComponentUpdate(nextProps: Props, nextState: State): boolean {
    // We can't deeply compare children. If the developer memoizes them, we can
    // use this optimization.
    if (this.props.children !== nextProps.children) return true;
    if (this.props.droppingPosition !== nextProps.droppingPosition) return true;
    // TODO memoize these calculations so they don't take so long?
    const oldPosition = calcGridItemPosition(
      this.getPositionParams(this.props),
      this.props.x,
      this.props.y,
      this.props.w,
      this.props.h,
      this.state
    );
    const newPosition = calcGridItemPosition(
      this.getPositionParams(nextProps),
      nextProps.x,
      nextProps.y,
      nextProps.w,
      nextProps.h,
      nextState
    );
    return (
      !fastPositionEqual(oldPosition, newPosition) ||
      this.props.useCSSTransforms !== nextProps.useCSSTransforms
    );
  }

  componentDidMount() {
    this.moveDroppingItem({});
  }

  componentDidUpdate(prevProps: Props) {
    this.moveDroppingItem(prevProps);
  }

  // When a droppingPosition is present, this means we should fire a move event, as if we had moved
  // this element by `x, y` pixels.
  moveDroppingItem(prevProps: Partial<Props>) {
    const { droppingPosition, handle } = this.props;
    if (!droppingPosition) return;
    const node = this.elementRef.current;
    // Can't find DOM node (are we unmounted?)
    if (!node) return;

    const prevDroppingPosition = prevProps.droppingPosition || {
      left: 0,
      top: 0
    };
    const { dragging } = this.state;

    const shouldDrag =
      (dragging && droppingPosition.left !== prevDroppingPosition.left) ||
      droppingPosition.top !== prevDroppingPosition.top;

    if (this.props.mockDragItem?.i) {
      const children = this.elementRef.current?.childNodes;
      if (children?.length) {
        children.forEach((child: HTMLElement) => {
          const match = matchesSelector(child, handle);
          if (match) {
            const event = document.createEvent("HTMLEvents");
            event.initEvent("mousedown", true, true);
            child.dispatchEvent(event);
          }
        });
      }
      this.props.clearMockDropItem && this.props.clearMockDropItem();
    }

    if (!dragging) {
      this.onDragStart(droppingPosition.e, {
        node,
        deltaX: droppingPosition.left,
        deltaY: droppingPosition.top
      });
    } else if (shouldDrag) {
      const deltaX = droppingPosition.left - dragging.left;
      const deltaY = droppingPosition.top - dragging.top;

      this.onDrag(droppingPosition.e, {
        node,
        deltaX,
        deltaY
      });
    }
  }

  getPositionParams(props: PositionParams = this.props): PositionParams {
    return {
      cols: props.cols,
      containerPadding: props.containerPadding,
      containerWidth: props.containerWidth,
      margin: props.margin,
      maxRows: props.maxRows,
      rowHeight: props.rowHeight
    };
  }

  /**
   * This is where we set the grid item's absolute placement. It gets a little tricky because we want to do it
   * well when server rendering, and the only way to do that properly is to use percentage width/left because
   * we don't know exactly what the browser viewport is.
   * Unfortunately, CSS Transforms, which are great for performance, break in this instance because a percentage
   * left is relative to the item itself, not its container! So we cannot use them on the server rendering pass.
   *
   * @param  {Object} pos Position object with width, height, left, top.
   * @return {Object}     Style object.
   */
  createStyle(pos: Position) {
    const { usePercentages, containerWidth, useCSSTransforms } = this.props;

    let style: React.CSSProperties;
    // CSS Transforms support (default)
    if (useCSSTransforms) {
      style = setTransform(pos);
    } else {
      // top,left (slow)
      style = setTopLeft(pos);

      // This is used for server rendering.
      if (usePercentages) {
        style.left = perc(pos.left / containerWidth);
        style.width = perc(pos.width / containerWidth);
      }
    }

    return style;
  }

  /**
   * Mix a Draggable instance into a child.
   * @param  {Element} child    Child element.
   * @return {Element}          Child wrapped in Draggable.
   */
  mixinDraggable(child: React.ReactElement<any>, isDraggable: boolean) {
    return (
      <DraggableCoreComp
        disabled={!isDraggable}
        onStart={this.onDragStart}
        onDrag={this.onDrag}
        onStop={this.onDragStop}
        handle={this.props.handle}
        cancel={
          ".react-resizable-handle" +
          (this.props.cancel ? "," + this.props.cancel : "")
        }
        scale={this.props.transformScale}
        nodeRef={this.elementRef}
      >
        {child}
      </DraggableCoreComp>
    );
  }

  /**
   * Mix a Resizable instance into a child.
   * @param  {Element} child    Child element.
   * @param  {Object} position  Position object (pixel values)
   * @return {Element}          Child wrapped in Resizable.
   */
  mixinResizable(
    child: React.ReactElement<any>,
    position: Position,
    isResizable: boolean
  ) {
    const {
      cols,
      x,
      minW,
      minH,
      maxW,
      maxH,
      transformScale,
      resizeHandles,
      resizeHandle
    } = this.props;
    const positionParams = this.getPositionParams();

    // This is the max possible width - doesn't go to infinity because of the width of the window
    const maxWidth = calcGridItemPosition(
      positionParams,
      0,
      0,
      cols - x,
      0
    ).width;

    // Calculate min/max constraints using our min & maxes
    const mins = calcGridItemPosition(positionParams, 0, 0, minW, minH);
    const maxes = calcGridItemPosition(positionParams, 0, 0, maxW, maxH);
    const minConstraints: [number, number] = [mins.width, mins.height];
    const maxConstraints: [number, number] = [
      Math.min(maxes.width, maxWidth),
      Math.min(maxes.height, Infinity)
    ];
    return (
      <Resizable
        // These are opts for the resize handle itself
        draggableOpts={{
          disabled: !isResizable
        }}
        className={isResizable ? undefined : "react-resizable-hide"}
        width={position.width}
        height={position.height}
        minConstraints={minConstraints}
        maxConstraints={maxConstraints}
        onResizeStop={this.onResizeStop}
        onResizeStart={this.onResizeStart}
        onResize={this.onResize}
        transformScale={transformScale}
        resizeHandles={resizeHandles}
        handle={resizeHandle}
      >
        {child}
      </Resizable>
    );
  }

  /**
   * onDragStart event handler
   * @param  {Event}  e             event data
   * @param  {Object} callbackData  an object with node, delta and position information
   */
  onDragStart: (e: React.DragEvent, r: ReactDraggableCallbackData) => void = (
    e,
    { node }
  ) => {
    const { onDragStart, transformScale } = this.props;
    if (!onDragStart) return;

    const newPosition: PartialPosition = { top: 0, left: 0 };

    // TODO: this wont work on nested parents
    const { offsetParent } = node;
    if (!offsetParent) return;
    const parentRect = offsetParent.getBoundingClientRect();
    const clientRect = node.getBoundingClientRect();
    const cLeft = clientRect.left / transformScale;
    const pLeft = parentRect.left / transformScale;
    const cTop = clientRect.top / transformScale;
    const pTop = parentRect.top / transformScale;
    newPosition.left = cLeft - pLeft + offsetParent.scrollLeft;
    newPosition.top = cTop - pTop + offsetParent.scrollTop;
    this.setState({ dragging: newPosition });

    // Call callback with this data
    const { x, y } = calcXY(
      this.getPositionParams(),
      newPosition.top,
      newPosition.left,
      this.props.w,
      this.props.h
    );

    return onDragStart.call(this, this.props.i, x, y, {
      e,
      node,
      newPosition
    });
  };

  /**
   * onDrag event handler
   * @param  {Event}  e             event data
   * @param  {Object} callbackData  an object with node, delta and position information
   */
  onDrag: (e: React.DragEvent, r: ReactDraggableCallbackData) => void = (
    e,
    { node, deltaX, deltaY }
  ) => {
    const { isBounded, onDrag, i, w, h, groupId, shuttle } = this.props;
    if (!onDrag) return;

    if (!this.state.dragging) {
      throw new Error("onDrag called before onDragStart.");
    }
    let top = this.state.dragging.top + deltaY;
    let left = this.state.dragging.left + deltaX;

    const positionParams = this.getPositionParams();

    // Boundary calculations; keeps items within the grid
    if (isBounded?.length) {
      const { offsetParent } = node;

      if (offsetParent) {
        const { margin, rowHeight, containerWidth } = this.props;
        const bottomBoundary =
          offsetParent.clientHeight - calcGridItemWHPx(h, rowHeight, margin[1]);
        top = clamp(
          top,
          includes(isBounded, "top") ? 0 : -Infinity,
          includes(isBounded, "bottom") ? bottomBoundary : Infinity
        );

        const colWidth = calcGridColWidth(positionParams);
        const rightBoundary =
          containerWidth - calcGridItemWHPx(w, colWidth, margin[0]);
        left = clamp(
          left,
          includes(isBounded, "left") ? 0 : -Infinity,
          includes(isBounded, "right") ? rightBoundary : Infinity
        );
      }
    }

    const newPosition: PartialPosition = { top, left };
    this.setState({ dragging: newPosition });

    // Call callback with this data
    const { x, y } = calcXY(positionParams, top, left, w, h);
    if (groupId && shuttle) {
      let nearest = detectNearestEmptySortable(e.clientX, e.clientY);
      if (nearest && nearest.elementRef !== this.props.parentRef) {
        const event = document.createEvent("HTMLEvents");
        event.initEvent("mouseup", true, true);
        document.dispatchEvent(event);
        this.moveNearest(nearest, { offsetX: 0, offsetY: 0, ...e });
      }
    }
    return onDrag.call(this, i, x, y, {
      e,
      node,
      newPosition
    });
  };

  moveNearest = (
    nearest: ReactGridLayout,
    e: React.DragEvent & { offsetX: number; offsetY: number }
  ) => {
    const { onDragCancel, i, w, h } = this.props;
    const { width, margin, containerPadding, cols, rowHeight, maxRows } =
      nearest.props;
    const positionParams = {
      margin,
      cols,
      containerPadding: containerPadding || margin,
      rowHeight,
      maxRows,
      containerWidth: width
    };
    const { offsetX, offsetY } = e;
    const { x, y } = calcXY(positionParams, offsetY, offsetX, w, h);
    onDragCancel?.call(this, i, x, y, nearest, e);
  };

  /**
   * onDragStop event handler
   * @param  {Event}  e             event data
   * @param  {Object} callbackData  an object with node, delta and position information
   */
  onDragStop: (e: Event, r: ReactDraggableCallbackData) => void = (
    e,
    { node }
  ) => {
    const { onDragStop } = this.props;
    if (!onDragStop) return;

    if (!this.state.dragging) {
      throw new Error("onDragEnd called before onDragStart.");
    }
    const { w, h, i } = this.props;
    const { left, top } = this.state.dragging;
    const newPosition: PartialPosition = { top, left };
    this.setState({ dragging: undefined });

    const { x, y } = calcXY(this.getPositionParams(), top, left, w, h);

    return onDragStop.call(this, i, x, y, {
      e,
      node,
      newPosition
    });
  };

  /**
   * onResizeStop event handler
   * @param  {Event}  e             event data
   * @param  {Object} callbackData  an object with node and size information
   */
  onResizeStop: (
    e: React.SyntheticEvent<Element, Event>,
    { node, size }: ResizeCallbackData
  ) => void = (e, callbackData) => {
    this.onResizeHandler(e, callbackData, "onResizeStop");
  };

  /**
   * onResizeStart event handler
   * @param  {Event}  e             event data
   * @param  {Object} callbackData  an object with node and size information
   */
  onResizeStart: (
    e: React.SyntheticEvent<Element, Event>,
    { node, size }: ResizeCallbackData
  ) => void = (e, callbackData) => {
    this.onResizeHandler(e, callbackData, "onResizeStart");
  };

  /**
   * onResize event handler
   * @param  {Event}  e             event data
   * @param  {Object} callbackData  an object with node and size information
   */
  onResize: (
    e: React.SyntheticEvent<Element, Event>,
    { node, size }: ResizeCallbackData
  ) => void = (e, callbackData) => {
    this.onResizeHandler(e, callbackData, "onResize");
  };

  /**
   * Wrapper around drag events to provide more useful data.
   * All drag events call the function with the given handler name,
   * with the signature (index, x, y).
   *
   * @param  {String} handlerName Handler name to wrap.
   * @return {Function}           Handler function.
   */
  onResizeHandler(
    e: React.SyntheticEvent<Element, Event>,
    { node, size }: ResizeCallbackData,
    handlerName: string
  ): void {
    const handler = this.props[handlerName as keyof Props];
    if (!handler || typeof handler !== "function") return;
    const { cols, x, y, i, maxH, minH } = this.props;
    let { minW, maxW } = this.props;

    // Get new XY
    let { w, h } = calcWH(
      this.getPositionParams(),
      size.width,
      size.height,
      x,
      y
    );

    // minW should be at least 1 (TODO propTypes validation?)
    minW = Math.max(minW, 1);

    // maxW should be at most (cols - x)
    maxW = Math.min(maxW, cols - x);

    // Min/max capping
    w = clamp(w, minW, maxW);
    h = clamp(h, minH, maxH);

    this.setState({
      resizing: handlerName === "onResizeStop" ? undefined : size
    });

    handler.call(this, i, w, h, { e, node, size });
  }

  render(): JSX.Element {
    const {
      x,
      y,
      w,
      h,
      isDraggable,
      isResizable,
      droppingPosition,
      useCSSTransforms
    } = this.props;

    const pos = calcGridItemPosition(
      this.getPositionParams(),
      x,
      y,
      w,
      h,
      this.state
    );
    const child = React.Children.only(this.props.children);

    // Create the child element. We clone the existing element but modify its className and style.
    let newChild = React.cloneElement(child, {
      ref: this.elementRef,
      className: clsx(
        "react-grid-item",
        child.props.className,
        this.props.className,
        {
          static: this.props.static,
          resizing: Boolean(this.state.resizing),
          "react-draggable": isDraggable,
          "react-draggable-dragging": Boolean(this.state.dragging),
          dropping: Boolean(droppingPosition),
          cssTransforms: useCSSTransforms
        }
      ),
      // We can set the width and height on the child, but unfortunately we can't set the position.
      style: {
        ...this.props.style,
        ...child.props.style,
        ...this.createStyle(pos)
      }
    });

    // Resizable support. This is usually on but the user can toggle it off.
    newChild = this.mixinResizable(newChild, pos, isResizable);

    // Draggable support. This is always on, except for with placeholders.
    newChild = this.mixinDraggable(newChild, isDraggable);

    return newChild;
  }
}
