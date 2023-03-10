// @flow
import * as React from "react";

import { assign, isEqual } from "./lodash-es";
import clsx from "clsx";
import {
  bottom,
  childrenEqual,
  cloneLayoutItem,
  compact,
  compactType,
  fastRGLPropsEqual,
  getAllCollisions,
  getLayoutItem,
  moveElement,
  noop,
  synchronizeLayoutWithChildren,
  withLayoutItem
} from "./utils";

import { calcXY } from "./calculateUtils";

import GridItem from "./GridItem";
import ReactGridLayoutPropTypes from "./ReactGridLayoutPropTypes";

// Types
import type {
  CompactType,
  GridResizeEvent,
  GridDragEvent,
  Layout,
  DroppingPosition,
  LayoutItem
} from "./utils";

import type { PositionParams } from "./calculateUtils";

type State = {
  activeDrag?: LayoutItem;
  layout: Layout;
  mounted: boolean;
  oldDragItem?: LayoutItem;
  oldLayout?: Layout;
  oldResizeItem?: LayoutItem;
  droppingDOMNode?: React.ReactElement<any>;
  droppingPosition?: DroppingPosition;
  // Mirrored props
  children?: React.ReactNode;
  compactType?: CompactType;
  propsLayout?: Layout;
  mockDragItem?: LayoutItem;
};

import type {
  ReactGridLayoutProps,
  DefaultProps
} from "./ReactGridLayoutPropTypes";
import { RGLMap } from "./group";

// End Types

const layoutClassName = "react-grid-layout";
let isFirefox = false;
// Try...catch will protect from navigator not existing (e.g. node) or a bad implementation of navigator
try {
  isFirefox = /firefox/i.test(navigator.userAgent);
} catch (e) {
  /* Ignore */
}

/**
 * A reactive, fluid grid layout with draggable, resizable components.
 */

export default class ReactGridLayout extends React.Component<
  ReactGridLayoutProps,
  State
> {
  // TODO publish internal ReactClass displayName transform
  static displayName?: string = "ReactGridLayout";

  // Refactored to another module to make way for preval
  static propTypes = ReactGridLayoutPropTypes;

  static defaultProps: Partial<DefaultProps> = {
    autoSize: true,
    cols: 12,
    className: "",
    style: {},
    draggableHandle: "",
    draggableCancel: "",
    containerPadding: undefined,
    rowHeight: 150,
    maxRows: Infinity, // infinite vertical growth
    layout: [],
    margin: [10, 10],
    isDraggable: true,
    isResizable: true,
    allowOverlap: false,
    isDroppable: false,
    useCSSTransforms: true,
    transformScale: 1,
    verticalCompact: true,
    compactType: "vertical",
    preventCollision: false,
    droppingItem: {
      i: "__dropping-elem__",
      h: 1,
      w: 1
    },
    resizeHandles: ["se"],
    onLayoutChange: noop,
    onDragStart: noop,
    onDrag: noop,
    onDragStop: noop,
    onDragCancel: noop,
    onResizeStart: noop,
    onResize: noop,
    onResizeStop: noop,
    onDrop: noop,
    onDropDragOver: noop
  };

  state: State = {
    activeDrag: undefined,
    layout: synchronizeLayoutWithChildren(
      this.props.layout,
      this.props.children,
      this.props.cols,
      // Legacy support for verticalCompact: false
      compactType(this.props),
      this.props.allowOverlap
    ),
    mounted: false,
    oldDragItem: undefined,
    oldLayout: undefined,
    oldResizeItem: undefined,
    droppingDOMNode: undefined
  };

  elementRef = React.createRef<HTMLDivElement>();

  dragEnterCounter: number = 0;

  componentDidMount() {
    this.setState({ mounted: true });
    // Possibly call back with layout on mount. This should be done after correcting the layout width
    // to ensure we don't rerender with the wrong width.
    this.onLayoutMaybeChanged(this.state.layout, this.props.layout);
    this.props.groupId && (RGLMap[this.props.groupId] = this);
  }

  componentWillUnmount(): void {
    this.props.groupId && (RGLMap[this.props.groupId] = this);
  }

  static getDerivedStateFromProps(
    nextProps: ReactGridLayoutProps,
    prevState: State
  ): Partial<State> | null {
    let newLayoutBase;

    if (prevState.activeDrag) {
      return null;
    }

    // Legacy support for compactType
    // Allow parent to set layout directly.
    if (
      !isEqual(nextProps.layout, prevState.propsLayout) ||
      nextProps.compactType !== prevState.compactType
    ) {
      newLayoutBase = nextProps.layout;
    } else if (!childrenEqual(nextProps.children, prevState.children)) {
      // If children change, also regenerate the layout. Use our state
      // as the base in case because it may be more up to date than
      // what is in props.
      newLayoutBase = prevState.layout;
    }

    // We need to regenerate the layout.
    if (newLayoutBase) {
      const newLayout = synchronizeLayoutWithChildren(
        newLayoutBase,
        nextProps.children,
        nextProps.cols,
        compactType(nextProps),
        nextProps.allowOverlap
      );

      return {
        layout: newLayout,
        // We need to save these props to state for using
        // getDerivedStateFromProps instead of componentDidMount (in which we would get extra rerender)
        compactType: nextProps.compactType,
        children: nextProps.children,
        propsLayout: nextProps.layout
      };
    }

    return null;
  }

  shouldComponentUpdate(
    nextProps: ReactGridLayoutProps,
    nextState: State
  ): boolean {
    return (
      // NOTE: this is almost always unequal. Therefore the only way to get better performance
      // from SCU is if the user intentionally memoizes children. If they do, and they can
      // handle changes properly, performance will increase.
      this.props.children !== nextProps.children ||
      !fastRGLPropsEqual(this.props, nextProps, isEqual) ||
      this.state.activeDrag !== nextState.activeDrag ||
      this.state.mounted !== nextState.mounted ||
      this.state.droppingPosition !== nextState.droppingPosition
    );
  }

  componentDidUpdate(prevProps: ReactGridLayoutProps, prevState: State) {
    if (!this.state.activeDrag) {
      const newLayout = this.state.layout;
      const oldLayout = prevState.layout;

      this.onLayoutMaybeChanged(newLayout, oldLayout);
    }
  }

  /**
   * Calculates a pixel value for the container.
   * @return {String} Container height in pixels.
   */
  containerHeight() {
    if (!this.props.autoSize) return;
    const nbRow = bottom(this.state.layout);
    const containerPaddingY = this.props.containerPadding
      ? this.props.containerPadding[1]
      : this.props.margin[1];
    return (
      nbRow * this.props.rowHeight +
      (nbRow - 1) * this.props.margin[1] +
      containerPaddingY * 2 +
      "px"
    );
  }

  /**
   * When dragging starts
   * @param {String} i Id of the child
   * @param {Number} x X position of the move
   * @param {Number} y Y position of the move
   * @param {Event} e The mousedown event
   * @param {Element} node The current dragging DOM element
   */
  onDragStart: (i: string, x: number, y: number, g: GridDragEvent) => void = (
    i: string,
    x: number,
    y: number,
    { e, node }: GridDragEvent
  ) => {
    const { layout } = this.state;
    const l = getLayoutItem(layout, i);
    if (!l) return;

    this.setState({
      oldDragItem: cloneLayoutItem(l),
      oldLayout: layout
    });

    return this.props.onDragStart(layout, l, l, undefined, e, node);
  };

  /**
   * Each drag movement create a new dragelement and move the element to the dragged location
   * @param {String} i Id of the child
   * @param {Number} x X position of the move
   * @param {Number} y Y position of the move
   * @param {Event} e The mousedown event
   * @param {Element} node The current dragging DOM element
   */
  onDrag: (i: string, x: number, y: number, g: GridDragEvent) => void = (
    i,
    x,
    y,
    { e, node }
  ) => {
    const { oldDragItem } = this.state;
    let { layout } = this.state;
    const { cols, allowOverlap, preventCollision } = this.props;
    const l = getLayoutItem(layout, i);
    if (!l) return;

    // Create placeholder (display only)
    const placeholder = {
      w: l.w,
      h: l.h,
      x: l.x,
      y: l.y,
      placeholder: true,
      i: i
    };

    // Move the element to the dragged location.
    const isUserAction = true;
    layout = moveElement(
      layout,
      l,
      x,
      y,
      isUserAction,
      preventCollision,
      compactType(this.props),
      cols,
      allowOverlap
    );

    this.props.onDrag(layout, oldDragItem, l, placeholder, e, node);

    this.setState({
      layout: allowOverlap
        ? layout
        : compact(layout, compactType(this.props), cols),
      activeDrag: placeholder
    });
  };

  /**
   * When dragging stops, figure out which position the element is closest to and update its x and y.
   * @param  {String} i Index of the child.
   * @param {Number} x X position of the move
   * @param {Number} y Y position of the move
   * @param {Event} e The mousedown event
   * @param {Element} node The current dragging DOM element
   */
  onDragStop: (i: string, x: number, y: number, g: GridDragEvent) => void = (
    i,
    x,
    y,
    { e, node }
  ) => {
    if (!this.state.activeDrag) return;

    const { oldDragItem } = this.state;
    let { layout } = this.state;
    const { cols, preventCollision, allowOverlap } = this.props;
    const l = getLayoutItem(layout, i);
    if (!l) return;

    // Move the element here
    const isUserAction = true;
    layout = moveElement(
      layout,
      l,
      x,
      y,
      isUserAction,
      preventCollision,
      compactType(this.props),
      cols,
      allowOverlap
    );

    this.props.onDragStop(layout, oldDragItem, l, undefined, e, node);

    // Set state
    const newLayout = allowOverlap
      ? layout
      : compact(layout, compactType(this.props), cols);
    const { oldLayout } = this.state;
    this.setState({
      activeDrag: undefined,
      layout: newLayout,
      oldDragItem: undefined,
      oldLayout: undefined
    });

    this.onLayoutMaybeChanged(newLayout, oldLayout);
  };

  onDragCancel = (
    i: string,
    x: number,
    y: number,
    nearest: ReactGridLayout,
    e: React.DragEvent & { offsetX: number; offsetY: number }
  ) => {
    let { layout } = this.state;
    const newLayout = layout.filter(item => item.i !== i);
    let l = getLayoutItem(layout, i);
    if (!l) return;
    assign(l, { x, y });
    this.setState({
      activeDrag: undefined,
      layout: newLayout,
      oldDragItem: undefined,
      oldLayout: undefined
    });
    this.props.onDragCancel(layout, l, nearest.props.groupId!);
    const { transformScale } = this.props;
    const { offsetX: layerX, offsetY: layerY } = e;
    const droppingPosition = {
      left: layerX / transformScale,
      top: layerY / transformScale,
      e
    };
    nearest.setState({
      layout: [...nearest.state.layout, l],
      mockDragItem: l,
      droppingPosition
    });
  };

  clearMockDropItem = () => {
    this.setState({ droppingPosition: undefined, mockDragItem: undefined });
  };

  onLayoutMaybeChanged(newLayout: Layout, oldLayout?: Layout) {
    if (!oldLayout) oldLayout = this.state.layout;

    if (!isEqual(oldLayout, newLayout)) {
      this.props.onLayoutChange(newLayout);
    }
  }

  onResizeStart: (i: string, w: number, h: number, g: GridResizeEvent) => void =
    (i, w, h, { e, node }) => {
      const { layout } = this.state;
      const l = getLayoutItem(layout, i);
      if (!l) return;

      this.setState({
        oldResizeItem: cloneLayoutItem(l),
        oldLayout: this.state.layout
      });

      this.props.onResizeStart(layout, l, l, undefined, e, node);
    };

  onResize: (i: string, w: number, h: number, g: GridResizeEvent) => void = (
    i,
    w,
    h,
    { e, node }
  ) => {
    const { layout, oldResizeItem } = this.state;
    const { cols, preventCollision, allowOverlap } = this.props;

    const [newLayout, l] = withLayoutItem(layout, i, l => {
      // Something like quad tree should be used
      // to find collisions faster
      let hasCollisions;
      if (preventCollision && !allowOverlap) {
        const collisions = getAllCollisions(layout, { ...l, w, h }).filter(
          layoutItem => layoutItem.i !== l.i
        );
        hasCollisions = collisions.length > 0;

        // If we're colliding, we need adjust the placeholder.
        if (hasCollisions) {
          // adjust w && h to maximum allowed space
          let leastX = Infinity,
            leastY = Infinity;
          collisions.forEach(layoutItem => {
            if (layoutItem.x > l.x) leastX = Math.min(leastX, layoutItem.x);
            if (layoutItem.y > l.y) leastY = Math.min(leastY, layoutItem.y);
          });

          if (Number.isFinite(leastX)) l.w = leastX - l.x;
          if (Number.isFinite(leastY)) l.h = leastY - l.y;
        }
      }

      if (!hasCollisions) {
        // Set new width and height.
        l.w = w;
        l.h = h;
      }

      return l;
    });

    // Shouldn't ever happen, but typechecking makes it necessary
    if (!l) return;

    // Create placeholder element (display only)
    const placeholder = {
      w: l.w,
      h: l.h,
      x: l.x,
      y: l.y,
      static: true,
      i: i
    };

    this.props.onResize(newLayout, oldResizeItem, l, placeholder, e, node);

    // Re-compact the newLayout and set the drag placeholder.
    this.setState({
      layout: allowOverlap
        ? newLayout
        : compact(newLayout, compactType(this.props), cols),
      activeDrag: placeholder
    });
  };

  onResizeStop: (i: string, w: number, h: number, g: GridResizeEvent) => void =
    (i, w, h, { e, node }) => {
      const { layout, oldResizeItem } = this.state;
      const { cols, allowOverlap } = this.props;
      const l = getLayoutItem(layout, i);

      this.props.onResizeStop(layout, oldResizeItem, l, undefined, e, node);

      // Set state
      const newLayout = allowOverlap
        ? layout
        : compact(layout, compactType(this.props), cols);
      const { oldLayout } = this.state;
      this.setState({
        activeDrag: undefined,
        layout: newLayout,
        oldResizeItem: undefined,
        oldLayout: undefined
      });

      this.onLayoutMaybeChanged(newLayout, oldLayout);
    };

  /**
   * Create a placeholder object.
   * @return {Element} Placeholder div.
   */
  placeholder() {
    const { activeDrag } = this.state;
    if (!activeDrag) return null;
    const {
      width,
      cols,
      margin,
      containerPadding,
      rowHeight,
      maxRows,
      useCSSTransforms,
      transformScale
    } = this.props;

    // {...this.state.activeDrag} is pretty slow, actually
    return (
      <GridItem
        w={activeDrag.w}
        h={activeDrag.h}
        x={activeDrag.x}
        y={activeDrag.y}
        i={activeDrag.i}
        className="react-grid-placeholder"
        containerWidth={width}
        cols={cols}
        margin={margin}
        containerPadding={containerPadding || margin}
        maxRows={maxRows}
        rowHeight={rowHeight}
        isDraggable={false}
        isResizable={false}
        useCSSTransforms={useCSSTransforms}
        transformScale={transformScale}
      >
        <div />
      </GridItem>
    );
  }

  /**
   * Given a grid item, set its style attributes & surround in a <Draggable>.
   * @param  {Element} child React element.
   * @return {Element}       Element wrapped in draggable and properly placed.
   */
  processGridItem(child?: JSX.Element, isDroppingItem?: boolean) {
    if (!child || !child.key) return;
    const l = getLayoutItem(this.state.layout, String(child.key));
    if (!l) return null;
    const {
      width,
      cols,
      margin,
      containerPadding,
      rowHeight,
      maxRows,
      isDraggable,
      isResizable,
      isBounded,
      useCSSTransforms,
      transformScale,
      draggableCancel,
      draggableHandle,
      resizeHandles,
      resizeHandle
    } = this.props;
    const { mounted, droppingPosition } = this.state;

    // Determine user manipulations possible.
    // If an item is static, it can't be manipulated by default.
    // Any properties defined directly on the grid item will take precedence.
    const draggable =
      typeof l.isDraggable === "boolean"
        ? l.isDraggable
        : !l.static && isDraggable;
    const resizable =
      typeof l.isResizable === "boolean"
        ? l.isResizable
        : !l.static && isResizable;
    const resizeHandlesOptions = l.resizeHandles || resizeHandles;

    return (
      <GridItem
        {...l}
        containerWidth={width}
        cols={cols}
        margin={margin}
        containerPadding={containerPadding || margin}
        maxRows={maxRows}
        rowHeight={rowHeight}
        cancel={draggableCancel}
        handle={draggableHandle}
        mockDragItem={this.state.mockDragItem}
        clearMockDropItem={this.clearMockDropItem}
        onDragStop={this.onDragStop}
        onDragStart={this.onDragStart}
        onDrag={this.onDrag}
        onDragCancel={this.onDragCancel}
        onResizeStart={this.onResizeStart}
        onResize={this.onResize}
        onResizeStop={this.onResizeStop}
        isDraggable={draggable}
        isResizable={resizable}
        isBounded={draggable ? l.isBounded || isBounded : undefined}
        useCSSTransforms={useCSSTransforms && mounted}
        usePercentages={!mounted}
        transformScale={transformScale}
        droppingPosition={
          isDroppingItem || this.state.mockDragItem?.i === l.i
            ? droppingPosition
            : undefined
        }
        resizeHandles={resizeHandlesOptions}
        resizeHandle={resizeHandle}
        groupId={this.props.groupId}
        parentRef={this.elementRef}
      >
        {child}
      </GridItem>
    );
  }

  // Called while dragging an element. Part of browser native drag/drop API.
  // Native event target might be the layout itself, or an element within the layout.
  onDragOver: React.DragEventHandler = e => {
    e.preventDefault(); // Prevent any browser native action
    e.stopPropagation();

    // we should ignore events from layout's children in Firefox
    // to avoid unpredictable jumping of a dropping placeholder
    // FIXME remove this hack
    if (
      isFirefox &&
      // $FlowIgnore can't figure this out
      !(e.nativeEvent.target as Element)?.classList.contains(layoutClassName)
    ) {
      return false;
    }

    const {
      droppingItem,
      onDropDragOver,
      margin,
      cols,
      rowHeight,
      maxRows,
      width,
      containerPadding,
      transformScale
    } = this.props;
    // Allow user to customize the dropping item or short-circuit the drop based on the results
    // of the `onDragOver(e: Event)` callback.
    const onDragOverResult = onDropDragOver?.(e);
    if (onDragOverResult === false) {
      if (this.state.droppingDOMNode) {
        this.removeDroppingPlaceholder();
      }
      return false;
    }
    const finalDroppingItem = {
      i: "",
      w: 0,
      h: 0,
      ...droppingItem,
      ...onDragOverResult
    };

    const { layout } = this.state;
    // This is relative to the DOM element that this event fired for.
    const { offsetX, offsetY } = e.nativeEvent;
    const droppingPosition = {
      left: offsetX / transformScale,
      top: offsetY / transformScale,
      e
    };

    if (!this.state.droppingDOMNode) {
      const positionParams: PositionParams = {
        cols,
        margin,
        maxRows,
        rowHeight,
        containerWidth: width,
        containerPadding: containerPadding || margin
      };

      const calculatedPosition = calcXY(
        positionParams,
        offsetY,
        offsetX,
        finalDroppingItem.w,
        finalDroppingItem.h
      );

      this.setState({
        droppingDOMNode: <div key={finalDroppingItem.i} />,
        droppingPosition,
        layout: [
          ...layout,
          {
            ...finalDroppingItem,
            x: calculatedPosition.x,
            y: calculatedPosition.y,
            static: false,
            isDraggable: true
          }
        ]
      });
    } else if (this.state.droppingPosition) {
      const { left, top } = this.state.droppingPosition;
      const shouldUpdatePosition = left != offsetX || top != offsetY;
      if (shouldUpdatePosition) {
        this.setState({ droppingPosition });
      }
    }
  };

  removeDroppingPlaceholder: () => void = () => {
    const { droppingItem, cols } = this.props;
    const { layout } = this.state;

    const newLayout = compact(
      layout.filter(l => l.i !== droppingItem.i),
      compactType(this.props),
      cols
    );

    this.setState({
      layout: newLayout,
      droppingDOMNode: undefined,
      activeDrag: undefined,
      droppingPosition: undefined
    });
  };

  onDragLeave: React.MouseEventHandler = e => {
    e.preventDefault(); // Prevent any browser native action
    e.stopPropagation();
    this.dragEnterCounter--;

    // onDragLeave can be triggered on each layout's child.
    // But we know that count of dragEnter and dragLeave events
    // will be balanced after leaving the layout's container
    // so we can increase and decrease count of dragEnter and
    // when it'll be equal to 0 we'll remove the placeholder
    if (this.dragEnterCounter === 0) {
      this.removeDroppingPlaceholder();
    }
  };

  onDragEnter: React.MouseEventHandler = e => {
    e.preventDefault(); // Prevent any browser native action
    e.stopPropagation();
    this.dragEnterCounter++;
  };

  onDrop: React.DragEventHandler = e => {
    e.preventDefault(); // Prevent any browser native action
    e.stopPropagation();
    const { droppingItem } = this.props;
    const { layout } = this.state;
    const item = layout.find(l => l.i === droppingItem.i);

    // reset dragEnter counter on drop
    this.dragEnterCounter = 0;

    this.removeDroppingPlaceholder();

    this.props.onDrop(layout, item, e);
  };

  render() {
    let { className, style, isDroppable, innerRef } = this.props;

    const mergedClassName = clsx(layoutClassName, className);
    const mergedStyle = {
      height: this.containerHeight(),
      ...style
    };

    return (
      <div
        ref={r => {
          assign(this.elementRef, { current: r });
          innerRef && assign(innerRef, { current: r });
        }}
        className={mergedClassName}
        style={mergedStyle}
        onDrop={isDroppable ? this.onDrop : noop}
        onDragLeave={isDroppable ? this.onDragLeave : noop}
        onDragEnter={isDroppable ? this.onDragEnter : noop}
        onDragOver={isDroppable ? this.onDragOver : noop}
      >
        {React.Children.map(this.props.children, (child: JSX.Element) =>
          this.processGridItem(child)
        )}
        {isDroppable &&
          this.state.droppingDOMNode &&
          this.processGridItem(this.state.droppingDOMNode, true)}
        {this.placeholder()}
      </div>
    );
  }
}
