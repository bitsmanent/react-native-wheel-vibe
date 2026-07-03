# react-native-wheel-vibe

A high-performance, UI-thread native 3D wheel picker designed to address the performance and architectural limitations of traditional ScrollView-based or native wrapper pickers in React Native.

Built on top of **React Native Reanimated** and **React Native Gesture Handler**, `react-native-wheel-vibe` bypasses the JS-to-Native bridge entirely during interaction, running mathematical layout projections and physics-based momentum directly on the native render thread.

### Why this library?

Most React Native wheel pickers on npm rely on platform-native wrappers (which are hard to style and customize) or hacky `ScrollView`/`FlatList` listener bindings that drop frames during rapid scrolling. `react-native-wheel-vibe` was written from the ground up to solve these issues through professional engineering choices:

- **True 2.5D Cylindrical Projection:** Items are translated and rotated dynamically using exact trigonometric calculations ($\sin$ and $\cos$) on the UI thread to simulate a realistic physical wheel.
- **Deterministic Tap-to-Select:** Instead of guessing the clicked item based on linear offsets, a reverse trigonometric projection ($\arcsin$) is used to compute the exact item tapped on the curved cylinder.
- **State-Sync Guard Rails:** Includes a programmatic race-condition guard. If your parent component updates the `selectedIndex` state mid-animation (a common cause of lockups in other libraries), the picker intercepts it safely, preventing animation loops or lockups.
- **Automated Sliding-Window Virtualization:** When rendering datasets larger than 80 items, the picker automatically switches to a virtualized layout window. This keeps the memory footprint low and constant ($O(1)$ relative to your list size).
- **Haptic Debouncing:** Built-in safeguards protect the native haptic engine from vibration-spam during high-velocity scrolls, ensuring a clean tactile feel.

---

## Table of Contents
1. [Features](#features)
2. [Installation](#installation)
3. [Configuration & Setup](#configuration--setup)
4. [Usage](#usage)
5. [API Reference (Props)](#api-reference-props)
6. [Mathematical Principles](#mathematical-principles)
7. [Complexity Analysis](#complexity-analysis)
8. [Note on AI-Assisted Development](#note-on-ai-assisted-development)

---

## Features

- **3D Projection:** Leverages real-time trigonometric calculations and rotation on the X-axis to simulate a cylindrical physical wheel.
- **UI-Thread Animation:** Executes gestures, momentum, and recoil physics directly on the native UI thread, bypassing JavaScript-to-Native bridge bottlenecks.
- **Automatic Virtualization:** Optimizes rendering dynamically by maintaining a small sliding window of items when dealing with large lists (threshold $> 80$ items).
- **Coordinate-to-Index Tap Detection:** Computes the exact physical target index when a user taps directly on a non-centered item.
- **Responsive Width Detection:** Uses an invisible measuring system to dynamically adjust container width when a fixed width is not explicitly provided.

---

## Installation

Install the library directly in your project:

```bash
# Using npm
npm install react-native-wheel-vibe

# Using yarn
yarn add react-native-wheel-vibe
```

### Peer Dependencies
To ensure native bridges are properly linked, your project must also have the following peer dependencies installed:
- `react-native-reanimated`
- `react-native-gesture-handler`

If they are not yet installed in your project, run:
```bash
# React Native CLI
npm install react-native-reanimated react-native-gesture-handler

# Expo
npx expo install react-native-reanimated react-native-gesture-handler
```

---

## Configuration & Setup

### 1. Babel Configuration (Reanimated Plugin)
Since this library heavily relies on Reanimated Worklets, your project configuration depends on your framework:

*   **Expo:** No additional Babel setup is required. The Babel plugin is automatically injected by `babel-preset-expo`.
*   **Bare React Native CLI:** You must add the Reanimated plugin to your `babel.config.js`:
    ```javascript
    module.exports = {
      presets: ['module:@react-native/babel-preset'],
      plugins: [
        'react-native-reanimated/plugin', // Must be listed last
      ],
    };
    ```

### 2. Gesture Handler Root
The library utilizes gestural inputs. By default, `wrapInRootView` is set to `true`, which automatically wraps the picker in a `<GestureHandlerRootView>`. 

However, in production applications, nesting multiple root views can lead to gesture conflicts or redundancy. It is highly recommended to set `wrapInRootView={false}` and wrap your entire app (or your page container) with a single `GestureHandlerRootView` at the root level:

```jsx
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <MyScreen />
    </GestureHandlerRootView>
  );
}
```

---

## Usage

### Simple Example

```jsx
import React, { useState } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import WheelPicker from 'react-native-wheel-vibe';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function App() {
  const [selectedIndex, setSelectedIndex] = useState(0);

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Selected: {MONTHS[selectedIndex]}</Text>
      <WheelPicker
        items={MONTHS}
        selectedIndex={selectedIndex}
        onChange={(index) => setSelectedIndex(index)}
        visibleItems={5}
        itemHeight={50}
        loop={true}
        wrapInRootView={false} // Recommended if App has a root GestureHandlerRootView
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  text: {
    fontSize: 18,
    marginBottom: 20,
    fontWeight: 'bold',
  },
});
```

---

## API Reference (Props)

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `items` | `Array<any>` | `[]` | Array of items to be displayed in the wheel. |
| `selectedIndex` | `number` | `0` | The index of the item that should be selected. |
| `onChange` | `(index: number) => void` | `undefined` | Callback fired when the physics animation has fully settled on a final index. |
| `onActiveIndexChange` | `(index: number) => void` | `undefined` | Real-time callback fired on the JS thread during scrolling when the active index changes. |
| `onTargetIndexChange` | `(index: number) => void` | `undefined` | Callback fired once a gesture finishes and a target resting index is calculated. |
| `onHapticFeedback` | `() => void` | `undefined` | Triggered every time the wheel snaps over a new item boundary. |
| `visibleItems` | `number` | `5` | The number of elements visible on the screen at one time (ideally an odd integer). |
| `itemHeight` | `number` | `50` | The logical height of each individual element in points. |
| `loop` | `boolean` | `false` | When true, enables infinite wrapping/scrolling. |
| `renderItem` | `(item: any, index: number) => React.ReactNode` | `undefined` | Custom renderer for items. Defaults to a standard `<Text>` component. |
| `itemToString` | `(item: any) => string` | `String` | Serializes items to strings for accessibility labels and automeasuring. |
| `style` | `StyleProp<ViewStyle>` | `undefined` | Style applied to the outer container. |
| `wrapInRootView` | `boolean` | `true` | When true, wraps the internal container in a `<GestureHandlerRootView>`. |
| `enableTapToSelect` | `boolean` | `true` | Allows users to select an item simply by tapping on its visible row. |
| `showSelectionIndicator` | `boolean` | `true` | Renders thin border lines isolating the selected item. |
| `selectionIndicatorStyle` | `StyleProp<ViewStyle>` | `undefined` | Style applied to the selection lines. |
| `renderSelectionIndicator` | `(props: { style: any }) => React.ReactNode` | `undefined` | Custom renderer for the selection highlight container. |
| `maxVelocityClamp` | `number` | `120` | Caps the velocity of swift gestures (Fling/Decay tracking). |
| `inertiaDeceleration` | `number` | `0.998` | The deceleration factor applied to inertia animations. |
| `hapticDebounceMs` | `number` | `45` | Minimum duration in milliseconds required between subsequent haptic feedback calls. |
| `accessibilityLabel` | `string` | `"Wheel picker"` | Root accessibility label for screen readers. |
| `getAccessibilityValue` | `(item: any, index: number) => string` | `undefined` | Standard formatter to state the value of the active index to accessibility engines. |

---

## Mathematical Principles

The wheel is projected on a simulated 3D cylindrical surface.

### 1. Radius & Step Angles
Let $V$ represent `visibleItems` and $H$ represent `itemHeight`.
The imaginary wheel radius $R$ is derived by scaling the height:
$$R = H \times 1.5$$

The angular step $\theta$ separating each element is:
$$\theta = \frac{\pi}{V + 1}$$

### 2. Cylindrical Projection
For any item at index $i$, given the current scrolled offset (expressed as a continuous float value $C$ stored in a Reanimated shared value):
$$d = i - C$$

If infinite loop is active, the relative distance $d$ is mapped to the closest semicircular arc:
$$d_{\text{loop}} = \left(\left(\left(d + \frac{N}{2}\right) \bmod N\right) + N\right) \bmod N - \frac{N}{2}$$

The target radial angle $\alpha$ of the item is:
$$\alpha = d \times \theta$$

Using $\alpha$, we map the flat item into a 3D perspective via the transform matrix:
- **Vertical Displacement:** $T_y = R \times \sin(\alpha)$
- **Depth Rotation:** $R_x = -\alpha \text{ rad}$
- **Opacity Falloff:** $O = \max(0, \cos(\alpha))$

### 3. Inverse Trigonometric Tap Mapping
When a tap event lands at a relative coordinate $y_{\text{offset}}$ from the vertical center of the picker, the corresponding offset index $\Delta_{\text{index}}$ is extracted via an arcsine calculation:
$$r = \max\left(-0.999, \min\left(0.999, \frac{y_{\text{offset}}}{R}\right)\right)$$
$$\Delta_{\text{index}} = \frac{\arcsin(r)}{\theta}$$

The absolute target index is then calculated on the UI thread:
$$\text{Target} = \text{round}(C + \Delta_{\text{index}})$$

---

## Complexity Analysis

### 1. Space Complexity (Memory footprint)
- **Small-Scale Lists ($N \le 80$):**
  The component renders the entire list of items without dynamic windowing:
  $$\text{Space} = O(N)$$
  where $N$ is the number of items.

- **Large-Scale Lists ($N > 80$):**
  To maintain a lightweight DOM hierarchy, virtualization is engaged. The rendering range is restricted to a sliding window of elements centered around the active index:
  $$\text{Window Size} = 2 \times \max(20, \lceil 3 \times V \rceil)$$
  $$\text{Space} = O(V)$$
  Here, space complexity is $O(1)$ relative to the total dataset size $N$, depending only on the configuration size $V$ (`visibleItems`).

### 2. Time Complexity
- **Measuring Scan (Auto-Sizer):**
  If no fixed width is supplied via `style.width`, the component performs a linear search to measure string sizes. It processes up to 1000 items to avoid blocking the main JavaScript thread during mounting:
  $$\text{Time}_{\text{Mount}} = O(\min(N, 1000))$$

- **Gesture Updating & Core Animations:**
  Because the worklets run in their compiled format on the C++ UI thread, scrolling updates, drag calculations, and snapping physics avoid context switches.
  $$\text{Time}_{\text{Render Frame}} = O(1)$$

---

## Note on AI-Assisted Development

This library was designed, written, and optimized with the assistance of artificial intelligence. The gestural systems, trigonometric projections, and performance-tuning mechanisms were generated by combining computational mathematics with React Native framework patterns.
