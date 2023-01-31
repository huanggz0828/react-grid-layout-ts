# React-Grid-Layout-ts

For a comprehensive list of options, please visit [https://github.com/react-grid-layout/react-grid-layout](https://github.com/react-grid-layout/react-grid-layout)

the changed options and the new group drag API as follows.

```typescript
// Item can be dragged between layouts with the same id
groupId?: string
// The old isBounded is a boolean value and can only be turned on and off.
// Now you can control four boundaries
isBounded?: Array<"left" | "right" | "top" | "bottom">
// When item drag leaves the current layout and enters a new layout
// The current layout will trigger onDragCancel function
onDragCancel?: (layout: Layout, layoutItem: LayoutItem, nearestId: string)=> void;
```

## Drag Item Between Layouts

```tsx
import GridLayout from "react-grid-layout";

import React, { useState } from 'react';
import ReactGridLayout from 'react-grid-layout';

const GroupGrid = ({ children1, children2 }) => {
    const [layout1, setLayout1] = useState([]);
    const [layout2, setLayout2] = useState([]);

    return (
        <>
            <ReactGridLayout
                groupId="default"
                isBounded={['left', 'top', 'left', 'right']}
                layout={layout1}
                onDragCancel={(layout, layoutItem, nearestId) => {
                    setLayout1(layout);
                }}
                onLayoutChange={setLayout1}
            >
                {children1}
            </ReactGridLayout>
            <ReactGridLayout
                groupId="default"
                isBounded={['left', 'top', 'left', 'right']}
                layout={layout2}
                onDragCancel={(layout, layoutItem, nearestId) => {
                    setLayout2(layout);
                }}
                onLayoutChange={setLayout2}
            >
                {children2}
            </ReactGridLayout>
        </>
    );
};
```
