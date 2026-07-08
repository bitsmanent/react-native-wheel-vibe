import React, { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import {
	usePanGesture,
	useTapGesture,
	useExclusiveGestures,
	GestureDetector,
	GestureHandlerRootView
} from 'react-native-gesture-handler';
import Animated, {
	useAnimatedStyle,
	useSharedValue,
	withSpring,
	withTiming,
	useAnimatedReaction,
	withDecay
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

const SPRING_CONFIG = { damping: 24, stiffness: 90, mass: 1.2 };
const MAX_VELOCITY_CLAMP = 120;
const HAPTIC_DEBOUNCE_MS = 45;

function getClampedIndex(index, count, isLooping) {
	'worklet';
	if (count <= 0) return 0;
	return isLooping
		? ((index % count) + count) % count
		: Math.max(0, Math.min(count - 1, index));
}

const PickerItem = React.memo(({ index, current, visibleItems, loop, itemsCount, radius, radPerItem, itemHeight, children }) => {
	const visibilityThreshold = (visibleItems / 2) + 1;

	const animatedStyle = useAnimatedStyle(() => {
		if (itemsCount <= 0) return { opacity: 0, display: 'none' };

		let diff = index - current.value;
		if (loop) {
			diff = (((diff + itemsCount / 2) % itemsCount) + itemsCount) % itemsCount - itemsCount / 2;
		}

		if (Math.abs(diff) >= visibilityThreshold) return { opacity: 0, display: 'none' };

		const angle = diff * radPerItem;
		return {
			opacity: Math.max(0, Math.cos(angle)),
			display: 'flex',
			transform: [
				{ perspective: 400 },
				{ translateY: radius * Math.sin(angle) },
				{ rotateX: `${-angle}rad` }
			]
		};
	});

	return (
		<Animated.View style={[styles.item, { height: itemHeight }, animatedStyle]} pointerEvents="none">
			{children}
		</Animated.View>
	);
});

export default function WheelPicker({
	items = [],
	selectedIndex = 0,
	onChange,
	onActiveIndexChange,
	onTargetIndexChange,
	onHapticFeedback,
	visibleItems = 5,
	itemHeight = 50,
	loop = false,
	renderItem,
	itemToString,
	style,
	wrapInRootView = true,
	enableTapToSelect = true,
	showSelectionIndicator = true,
	selectionIndicatorStyle,
	renderSelectionIndicator,
	maxVelocityClamp = MAX_VELOCITY_CLAMP,
	inertiaDeceleration = 0.998,
	hapticDebounceMs = HAPTIC_DEBOUNCE_MS,
	accessibilityLabel = "Wheel picker",
	getAccessibilityValue
}) {
	const itemsCount = items.length;
	const safeVisibleItems = Math.max(1, visibleItems);
	const safeItemHeight = Math.max(1, itemHeight);
	const radius = safeItemHeight * 1.5;
	const radPerItem = Math.PI / (safeVisibleItems + 1);

	const safeItemToString = itemToString || useCallback((item) => (item === null || item === undefined ? '' : String(item)), []);

	const onChangeRef = useRef(onChange);
	const onActiveIndexChangeRef = useRef(onActiveIndexChange);
	const onTargetIndexChangeRef = useRef(onTargetIndexChange);
	const onHapticFeedbackRef = useRef(onHapticFeedback);
	const lastHapticTime = useRef(0);

	onChangeRef.current = onChange;
	onActiveIndexChangeRef.current = onActiveIndexChange;
	onTargetIndexChangeRef.current = onTargetIndexChange;
	onHapticFeedbackRef.current = onHapticFeedback;

	const initialIndex = itemsCount > 0 && !loop ? Math.max(0, Math.min(itemsCount - 1, selectedIndex)) : selectedIndex;
	const current = useSharedValue(initialIndex);
	const startCurrent = useSharedValue(0);

	const [localActiveIndex, setLocalActiveIndex] = useState(initialIndex);
	const lastNotifiedIndex = useRef(initialIndex);
	const prevSelectedIndexRef = useRef(selectedIndex);

	// Ref to track whether we are currently inside an active callback execution
	const isEmittingCallbackRef = useRef(false);

	// Track the target index during gesture-driven scroll and animation
	const targetIndexRef = useRef(null);

	const stableOnSetTargetIndex = useCallback((index) => {
		targetIndexRef.current = index;
	}, []);

	const stableOnChange = useCallback((index) => {
		targetIndexRef.current = null; // Clear target once animation has fully settled
		lastNotifiedIndex.current = index;
		onChangeRef.current?.(index);
	}, []);

	const stableOnActiveIndexChange = useCallback((index) => {
		if (targetIndexRef.current !== null) {
			targetIndexRef.current = index;
		}
		lastNotifiedIndex.current = index;
		setLocalActiveIndex(index);

		isEmittingCallbackRef.current = true;
		onActiveIndexChangeRef.current?.(index);
		// Reset the flag in the next tick to cover asynchronous state updates
		setTimeout(() => {
			isEmittingCallbackRef.current = false;
		}, 0);
	}, []);

	const stableOnTargetIndexChange = useCallback((index) => {
		targetIndexRef.current = index;
		lastNotifiedIndex.current = index;

		isEmittingCallbackRef.current = true;
		onTargetIndexChangeRef.current?.(index);
		setTimeout(() => {
			isEmittingCallbackRef.current = false;
		}, 0);
	}, []);

	const stableOnHapticFeedback = useCallback(() => {
		const now = Date.now();
		if (now - lastHapticTime.current >= hapticDebounceMs) {
			lastHapticTime.current = now;
			onHapticFeedbackRef.current?.();
		}
	}, [hapticDebounceMs]);

	const hasFixedWidth = useMemo(() => StyleSheet.flatten(style)?.width !== undefined, [style]);

	const sizerItems = useMemo(() => {
		if (itemsCount === 0) return [];
		if (itemsCount <= 5) return items;

		const firstItem = items[0];
		if (firstItem !== null && firstItem !== undefined && (typeof firstItem === 'string' || typeof firstItem === 'number')) {
			let longestIndex = 0;
			let maxLength = safeItemToString(firstItem).length;
			const scanLimit = Math.min(itemsCount, 1000);

			for (let i = 1; i < scanLimit; i++) {
				const len = safeItemToString(items[i]).length;
				if (len > maxLength) {
					maxLength = len;
					longestIndex = i;
				}
			}
			return [items[longestIndex]];
		}
		return [items[0]];
	}, [items, itemsCount, safeItemToString]);

	const containerHeight = useMemo(() => {
		const maxAngle = ((safeVisibleItems - 1) / 2) * radPerItem;
		return (2 * radius * Math.sin(maxAngle)) + (safeItemHeight * Math.cos(maxAngle));
	}, [safeVisibleItems, safeItemHeight, radius, radPerItem]);

	useEffect(() => {
		if (__DEV__ && safeVisibleItems > 1 && safeVisibleItems % 2 === 0) {
			console.warn(`[WheelPicker]: 'visibleItems' (${safeVisibleItems}) should be an odd number to prevent layout clipping.`);
		}
	}, [safeVisibleItems]);

	useAnimatedReaction(
		() => itemsCount <= 0 ? 0 : getClampedIndex(Math.round(current.value), itemsCount, loop),
		(next, prev) => {
			if (prev !== null && prev !== undefined && next !== prev) {
				scheduleOnRN(stableOnActiveIndexChange, next);
				if (onHapticFeedback) scheduleOnRN(stableOnHapticFeedback);
			}
		},
		[itemsCount, loop, stableOnActiveIndexChange, stableOnHapticFeedback, onHapticFeedback]
	);

	useEffect(() => {
		if (itemsCount <= 0) return;

		const prevSelectedIndex = prevSelectedIndexRef.current;
		prevSelectedIndexRef.current = selectedIndex;

		// Guard 1: Ignore if the selectedIndex prop itself did not change.
		if (selectedIndex === prevSelectedIndex) return;

		// Development-mode detection of concurrent updates to selectedIndex during active scrolling
		if (__DEV__ && isEmittingCallbackRef.current) {
			console.warn(
				`[WheelPicker]: 'selectedIndex' has been changed to ${selectedIndex} directly inside an active scroll callback ('onActiveIndexChange' or 'onTargetIndexChange'). ` +
				`This operation cancels the ongoing animation and can lock up the wheel. ` +
				`To capture state updates, please use the 'onChange' callback instead.`
			);
		}

		// Guard 2: Ignore if the change is a result of our own active gesture or intermediate updates.
		// Added check on lastNotifiedIndex to mitigate timing misalignment (batching) of React state.
		if (targetIndexRef.current !== null) {
			if (
				selectedIndex === targetIndexRef.current ||
				selectedIndex === localActiveIndex ||
				selectedIndex === lastNotifiedIndex.current
			) {
				return;
			}
		}

		// Genuine external programmatic change occurred. Clear gesture state tracking.
		targetIndexRef.current = null;

		let target = selectedIndex;

		if (loop) {
			const currentIdx = ((current.value % itemsCount) + itemsCount) % itemsCount;
			const diff = (((selectedIndex - currentIdx + itemsCount / 2) % itemsCount) + itemsCount) % itemsCount - itemsCount / 2;
			target = current.value + diff;
		} else {
			target = Math.max(0, Math.min(itemsCount - 1, selectedIndex));
		}

		current.value = withTiming(target, { duration: 250 });
		setLocalActiveIndex(selectedIndex);
		lastNotifiedIndex.current = selectedIndex;
	}, [selectedIndex, loop, itemsCount, localActiveIndex]);

	const tapGesture = useTapGesture({
		onDeactivate: (event) => {
			'worklet';
			if (event.canceled || !enableTapToSelect || itemsCount <= 0) return;

			const yOffset = event.y - (containerHeight / 2);
			const clampedRatio = Math.max(-0.999, Math.min(0.999, yOffset / radius));
			const target = Math.round(current.value + Math.asin(clampedRatio) / radPerItem);
			const finalIndex = getClampedIndex(target, itemsCount, loop);

			scheduleOnRN(stableOnSetTargetIndex, finalIndex);
			scheduleOnRN(stableOnTargetIndexChange, finalIndex);

			current.value = withSpring(target, SPRING_CONFIG, () => {
				'worklet';
				scheduleOnRN(stableOnChange, finalIndex);
			});
		}
	}, [enableTapToSelect, containerHeight, radius, radPerItem, itemsCount, loop, stableOnSetTargetIndex, stableOnTargetIndexChange, stableOnChange]);

	const panGesture = usePanGesture({
		onActivate: () => {
			'worklet';
			startCurrent.value = current.value;
			scheduleOnRN(stableOnSetTargetIndex, getClampedIndex(Math.round(current.value), itemsCount, loop));
		},
		onUpdate: (event) => {
			'worklet';
			const nextValue = startCurrent.value - event.translationY / safeItemHeight;
			current.value = loop ? nextValue : Math.max(0, Math.min(itemsCount - 1, nextValue));
		},
		onFinalize: (event) => {
			'worklet';
			const success = !event.canceled;
			const indexVelocity = -event.velocityY / safeItemHeight;
			const finalVelocity = success ? Math.max(-maxVelocityClamp, Math.min(maxVelocityClamp, indexVelocity)) : 0;

			if (!success || Math.abs(finalVelocity) < 0.5) {
				const target = Math.round(current.value);
				const finalIndex = getClampedIndex(target, itemsCount, loop);

				scheduleOnRN(stableOnSetTargetIndex, finalIndex);
				if (success) scheduleOnRN(stableOnTargetIndexChange, finalIndex);

				current.value = withSpring(target, SPRING_CONFIG, () => {
					'worklet';
					if (success) scheduleOnRN(stableOnChange, finalIndex);
				});
			} else {
				current.value = withDecay(
					{
						velocity: finalVelocity,
						deceleration: inertiaDeceleration,
						clamp: loop ? undefined : [0, itemsCount - 1]
					},
					(finished) => {
						'worklet';
						if (finished) {
							const target = Math.round(current.value);
							const finalIndex = getClampedIndex(target, itemsCount, loop);

							scheduleOnRN(stableOnSetTargetIndex, finalIndex);
							scheduleOnRN(stableOnTargetIndexChange, finalIndex);

							current.value = withSpring(target, SPRING_CONFIG, () => {
								'worklet';
								scheduleOnRN(stableOnChange, finalIndex);
							});
						}
					}
				);
			}
		}
	}, [safeItemHeight, loop, itemsCount, stableOnSetTargetIndex, stableOnTargetIndexChange, stableOnChange, maxVelocityClamp, inertiaDeceleration]);

	const gesture = enableTapToSelect ? useExclusiveGestures(panGesture, tapGesture) : panGesture;

	const renderSingleItem = useCallback((item, index) =>
		renderItem ? renderItem(item, index) : <Text style={styles.defaultText}>{safeItemToString(item)}</Text>,
		[renderItem, safeItemToString]
	);

	const shouldVirtualize = itemsCount > 80;
	const windowRadius = shouldVirtualize ? Math.max(20, Math.ceil(safeVisibleItems * 3)) : itemsCount;

	const renderedItems = useMemo(() => {
		if (itemsCount === 0) return [];

		const slots = [];
		const start = shouldVirtualize ? (loop ? localActiveIndex - windowRadius : Math.max(0, localActiveIndex - windowRadius)) : 0;
		const end = shouldVirtualize ? (loop ? localActiveIndex + windowRadius : Math.min(itemsCount - 1, localActiveIndex + windowRadius)) : itemsCount - 1;

		for (let i = start; i <= end; i++) {
			const realIndex = getClampedIndex(i, itemsCount, loop);
			const item = items[realIndex];

			slots.push(
				<PickerItem
					key={shouldVirtualize ? `slot-${i}` : `item-${i}`}
					index={i}
					current={current}
					visibleItems={safeVisibleItems}
					loop={loop}
					itemsCount={itemsCount}
					radius={radius}
					radPerItem={radPerItem}
					itemHeight={safeItemHeight}
				>
					{renderSingleItem(item, i)}
				</PickerItem>
			);
		}
		return slots;
	}, [
		items,
		shouldVirtualize ? localActiveIndex : undefined, // Optimization: only trigger recreations when virtualization is enabled
		itemsCount,
		loop,
		safeVisibleItems,
		radius,
		radPerItem,
		safeItemHeight,
		renderSingleItem,
		shouldVirtualize,
		windowRadius
	]);

	const handleAccessibilityAction = useCallback((direction) => {
		const nextIndex = getClampedIndex(selectedIndex + direction, itemsCount, loop);
		if (nextIndex !== selectedIndex) {
			current.value = withTiming(nextIndex, { duration: 250 });
			stableOnChange(nextIndex);
		}
	}, [selectedIndex, itemsCount, loop, stableOnChange]);

	if (itemsCount === 0) return null;

	const activeItemValue = items[selectedIndex] !== undefined
		? (getAccessibilityValue ? getAccessibilityValue(items[selectedIndex], selectedIndex) : safeItemToString(items[selectedIndex]))
		: "";

	const indicatorStyle = useMemo(() => [
		styles.selectionIndicator,
		{ height: safeItemHeight, top: (containerHeight - safeItemHeight) / 2 },
		selectionIndicatorStyle
	], [safeItemHeight, containerHeight, selectionIndicatorStyle]);

	const content = (
		<GestureDetector gesture={gesture}>
			<View
				style={[styles.container, { height: containerHeight }]}
				accessible={true}
				accessibilityRole="adjustable"
				accessibilityLabel={accessibilityLabel}
				accessibilityValue={{ text: activeItemValue }}
				accessibilityState={{ disabled: itemsCount === 0 }}
				accessibilityActions={[
					{ name: 'increment', label: 'Increment value' },
					{ name: 'decrement', label: 'Decrement value' }
				]}
				onAccessibilityAction={(event) => {
					if (event.nativeEvent.actionName === 'increment') handleAccessibilityAction(1);
					if (event.nativeEvent.actionName === 'decrement') handleAccessibilityAction(-1);
				}}
			>
				{showSelectionIndicator && (
					renderSelectionIndicator
						? renderSelectionIndicator({ style: indicatorStyle })
						: <View style={indicatorStyle} pointerEvents="none" />
				)}

				{!hasFixedWidth && (
					<View style={styles.invisibleSizer} pointerEvents="none">
						{sizerItems.map((item, i) => (
							<View key={`sizer-${i}`} style={styles.sizerRow}>
								{renderSingleItem(item, i)}
							</View>
						))}
					</View>
				)}

				{renderedItems}
			</View>
		</GestureDetector>
	);

	return wrapInRootView ? (
		<GestureHandlerRootView style={[styles.root, style]}>{content}</GestureHandlerRootView>
	) : (
		<View style={[styles.root, style]}>{content}</View>
	);
}

const styles = StyleSheet.create({
	root: { alignSelf: 'flex-start' },
	container: { justifyContent: 'center', alignItems: 'center', overflow: 'hidden', width: '100%' },
	item: { position: 'absolute', justifyContent: 'center', alignItems: 'center', width: '100%' },
	invisibleSizer: { height: 0, overflow: 'hidden' },
	sizerRow: { flexDirection: 'row', alignItems: 'center' },
	defaultText: { fontSize: 18 },
	selectionIndicator: { position: 'absolute', left: 0, right: 0, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' }
});
