import L from 'leaflet';

import {
	Observer,
	Theme,
	ThemeContext,
	Button,
	Icon,
	Paper,
	Typography,
	Slider,
	Shown,
	TextField,
	Detached,
	useAbort,
} from '@destamatic/ui';

import Map from './Map.jsx';

Theme.define({
	mapInput: {
		position: 'relative',
		width: '100%',
		display: 'flex',
		flexDirection: 'column',
		gap: 8,
		minHeight: 0,
	},

	mapInput_controls: {
		display: 'flex',
		flexDirection: 'row',
		alignItems: 'center',
		flexWrap: 'wrap',
		gap: 10,
		width: '100%',
	},

	mapInput_controlsRow: {
		display: 'flex',
		gap: 8,
		alignItems: 'center',
	},

	mapInput_map: {
		width: '100%',
	},
});

const normalizeLatLng = (value, fallback = { lat: 0, lng: 0 }) => {
	if (!value) return fallback;
	if (Array.isArray(value) && value.length >= 2) return { lat: value[0], lng: value[1] };
	if (typeof value.lat === 'number' && typeof value.lng === 'number') return { lat: value.lat, lng: value.lng };
	return fallback;
};

const normalizeObserver = (value, fallback, mutable = true) => {
	if (value instanceof Observer) return value;
	if (!mutable) return Observer.immutable(value ?? fallback);
	return Observer.mutable(value ?? fallback);
};

const normalizeModes = (allowModes) => {
	const list = Array.isArray(allowModes) ? allowModes.filter(Boolean) : null;
	return list && list.length ? list : ['point', 'current', 'radius', 'search'];
};

const pickInitialMode = (modes, current) => {
	if (current && modes.includes(current)) return current;
	if (modes.includes('point')) return 'point';
	return modes[0] || 'point';
};

export default ThemeContext.use(h => {
	const MapInput = ({
		value,
		allowModes,
		minRadius = 100,
		maxRadius = 5000,
		radiusStep = 50,
		searchLimit = 8,
		searchMinLength = 3,
		defaultMode = null,
		autoLocate = false,
		draggableMarker = true,
		mapProps = {},
		mapHeight = 320,
		renderControls = null,
		controls = null,
		style,
	}, cleanup, mounted) => {
		const valueObserver = value?.observer instanceof Observer
			? value.observer
			: normalizeObserver(value ?? {}, {}, true);
		const modes = normalizeModes(allowModes);

		const mapRef = Observer.mutable(null);
		const center = Observer.mutable({ lat: 0, lng: 0 });
		const minRadiusObserver = Observer.immutable(minRadius);
		const maxRadiusObserver = Observer.immutable(maxRadius);
		const radiusStepObserver = Observer.immutable(radiusStep);
		const radius = Observer.mutable(minRadiusObserver.get());
		const mode = Observer.mutable(pickInitialMode(modes, defaultMode));
		const zoom = normalizeObserver(mapProps.zoom ?? 13, 13, true);
		const mapHeightObserver = mapHeight instanceof Observer ? mapHeight : Observer.immutable(mapHeight);
		const searchLimitObserver = searchLimit instanceof Observer ? searchLimit : Observer.immutable(searchLimit);
		const searchMinLengthObserver = searchMinLength instanceof Observer ? searchMinLength : Observer.immutable(searchMinLength);

		const searchQuery = Observer.mutable('');
		const searchResults = Observer.mutable([]);
		const searchOpen = Observer.mutable(false);
		const searchLoading = Observer.mutable(false);
		const searchError = Observer.mutable('');
		const searchAttribution = Observer.mutable('');
		const searchAnchorRef = Observer.mutable(null);
		const searchAnchorWidth = Observer.mutable(320);

		let marker = null;
		let circle = null;
		let syncingFromValue = false;
		let syncingToValue = false;

		const setValueField = (key, next) => {
			const current = valueObserver.get();
			if (current && typeof current === 'object' && current.observer) {
				current[key] = next;
				return;
			}

			valueObserver.set({
				...(current || {}),
				[key]: next,
			});
		};

		const applyMarker = (map, nextCenter) => {
			if (!map || !nextCenter) return;
			const latlng = [nextCenter.lat, nextCenter.lng];

			if (!marker) {
				marker = L.marker(latlng, { draggable: !!draggableMarker }).addTo(map);
				if (draggableMarker) {
					marker.on('dragend', () => {
						const pos = marker.getLatLng();
						center.set({ lat: pos.lat, lng: pos.lng });
					});
				}
			} else {
				marker.setLatLng(latlng);
			}
		};

		const applyCircle = (map, nextCenter, nextRadius, show) => {
			if (!map || !nextCenter) return;
			if (!show) {
				if (circle) {
					circle.remove();
					circle = null;
				}
				return;
			}

			const latlng = [nextCenter.lat, nextCenter.lng];
			if (!circle) {
				circle = L.circle(latlng, { radius: nextRadius }).addTo(map);
			} else {
				circle.setLatLng(latlng);
				circle.setRadius(nextRadius);
			}
		};

		const selectPoint = (latlng) => {
			center.set({ lat: latlng.lat, lng: latlng.lng });
			if (mode.get() === 'current' && modes.includes('point')) mode.set('point');
		};

		const requestLocation = () => {
			if (!navigator?.geolocation) return;
			navigator.geolocation.getCurrentPosition(
				(pos) => {
					const nextCenter = { lat: pos.coords.latitude, lng: pos.coords.longitude };
					center.set(nextCenter);
					if (modes.includes('current')) mode.set('current');
				},
				() => { },
				{ enableHighAccuracy: false, timeout: 10000, maximumAge: Infinity }
			);
		};

		cleanup(valueObserver.effect((next) => {
			if (syncingToValue) return;
			if (!next || typeof next !== 'object') return;

			syncingFromValue = true;
			const nextCenter = normalizeLatLng(next, null);
			if (nextCenter) center.set(nextCenter);

			const parsedRadius = parseFloat(next.radius);
			if (Number.isFinite(parsedRadius)) radius.set(parsedRadius);
			if (next.mode && modes.includes(next.mode)) mode.set(next.mode);
			syncingFromValue = false;
		}));

		cleanup(center.effect((next) => {
			const map = mapRef.get();
			if (map) applyMarker(map, next);
			if (map) applyCircle(map, next, radius.get(), mode.get() === 'radius');

			if (syncingFromValue) return;
			syncingToValue = true;
			setValueField('lat', next.lat);
			setValueField('lng', next.lng);
			syncingToValue = false;
		}));

		cleanup(radius.effect((next) => {
			const map = mapRef.get();
			if (map) applyCircle(map, center.get(), next, mode.get() === 'radius');

			if (syncingFromValue) return;
			syncingToValue = true;
			setValueField('radius', next);
			syncingToValue = false;
		}));

		cleanup(mode.effect((next) => {
			if (syncingFromValue) return;
			syncingToValue = true;
			setValueField('mode', next);
			syncingToValue = false;

			const map = mapRef.get();
			if (map) applyCircle(map, center.get(), radius.get(), next === 'radius');
		}));

		cleanup(mapRef.effect((map) => {
			if (!map) return;
			applyMarker(map, center.get());
			applyCircle(map, center.get(), radius.get(), mode.get() === 'radius');
		}));

		mounted(() => {
			const nextCenter = normalizeLatLng(valueObserver.get(), null);
			if (nextCenter) center.set(nextCenter);
			if (autoLocate && modes.includes('current')) requestLocation();
		});

		const radiusLabel = radius.map(r => `${Math.round(r)} m`);
		const showRadius = mode.map(m => m === 'radius');
		const showSearch = mode.map(m => m === 'search');
		const hasResults = searchResults.map(results => Array.isArray(results) && results.length > 0);
		const showEmptyResults = Observer.all([searchLoading, hasResults, searchError])
			.map(([loading, has, err]) => !loading && !has && !err);

		const api = {
			mode,
			setMode: (next) => mode.set(next),
			radius,
			setRadius: (next) => radius.set(next),
			center,
			setCenter: (next) => center.set(normalizeLatLng(next)),
			requestLocation,
			value: valueObserver,
			mapRef,
		};

		const runSearch = async () => {
			const query = (searchQuery.get() || '').trim();
			const minLen = searchMinLengthObserver.get();
			if (mode.get() !== 'search') mode.set('search');
			if (query.length < minLen) {
				searchError.set(`Enter at least ${minLen} characters.`);
				searchResults.set([]);
				searchOpen.set(true);
				return;
			}

			if (searchLoading.get()) return;
			searchLoading.set(true);
			searchError.set('');
			searchAttribution.set('');
			searchOpen.set(true);

			try {
				const limit = searchLimitObserver.get();
				const params = new URLSearchParams({ q: query, limit: String(limit) });
				const res = await fetch(`/api/geo/search?${params.toString()}`);
				const data = await res.json();
				if (!res.ok || !data?.ok) {
					searchError.set(data?.error || 'Search failed');
					searchResults.set([]);
					return;
				}
				searchResults.set(data?.results || []);
				searchAttribution.set(data?.attribution || '');
			} catch (err) {
				searchError.set('Search failed');
				searchResults.set([]);
			} finally {
				searchLoading.set(false);
			}
		};

		const selectSearchResult = (result) => {
			if (!result) return;
			selectPoint({ lat: result.lat, lng: result.lng });
			mode.set('search');
			searchOpen.set(false);
		};

		cleanup(mode.effect((next) => {
			if (next !== 'search') searchOpen.set(false);
		}));

		cleanup(searchOpen.effect((open) => {
			if (!open) return;
			return useAbort(signal => {
				const update = () => {
					const el = searchAnchorRef.get();
					if (!el) return;
					const nextWidth = el.getBoundingClientRect().width;
					if (Number.isFinite(nextWidth) && nextWidth > 0) searchAnchorWidth.set(nextWidth);
				};
				update();
				window.addEventListener('resize', update, { signal });
				window.addEventListener('scroll', update, { signal, passive: true });
			})();
		}));

		const defaultControls = <Paper type="mapInput_controls" style={{ padding: 10 }}>
			<div
				theme="mapInput_controlsRow"
				style={{
					display: 'flex',
					flexDirection: 'row',
					alignItems: 'center',
					flexWrap: 'wrap',
					gap: 12,
				}}
			>
				{modes.includes('point') ? <Button
					label="Point"
					icon={<Icon name="feather:map-pin" />}
					type={mode.map(m => m === 'point' ? 'contained' : 'outlined')}
					onClick={() => mode.set('point')}
				/> : null}
				{modes.includes('radius') ? <Button
					label="Radius"
					icon={<Icon name="feather:circle" />}
					type={mode.map(m => m === 'radius' ? 'contained' : 'outlined')}
					onClick={() => mode.set('radius')}
				/> : null}
				{modes.includes('current') ? <Button
					label="Current"
					icon={<Icon name="feather:crosshair" />}
					type={mode.map(m => m === 'current' ? 'contained' : 'outlined')}
					onClick={() => requestLocation()}
				/> : null}
				{modes.includes('search') ? <Button
					label="Search"
					icon={<Icon name="feather:search" />}
					type={mode.map(m => m === 'search' ? 'contained' : 'outlined')}
					onClick={() => mode.set('search')}
				/> : null}

				<Shown value={showRadius}>
					<div
						theme="mapInput_controlsRow"
						style={{
							display: 'flex',
							flexDirection: 'row',
							alignItems: 'center',
							gap: 8,
							flexWrap: 'wrap',
						}}
					>
						<Typography type="p2" label="Radius" />
						<Typography type="p2" label={radiusLabel} />
						<div style={{ minWidth: 220 }}>
							<Slider
								value={radius}
								min={minRadiusObserver}
								max={maxRadiusObserver}
								step={radiusStepObserver}
							/>
						</div>
					</div>
				</Shown>

				<Shown value={showSearch}>
					<Detached
						enabled={searchOpen}
						locations={[
							Detached.BOTTOM_LEFT_RIGHT,
							Detached.BOTTOM_RIGHT_LEFT,
						]}
						style={{ zIndex: 2000 }}
					>
						<mark:anchor>
							<div
								ref={searchAnchorRef}
								style={{ minWidth: 260, flex: 1, display: 'flex', alignItems: 'center' }}
							>
								<div
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: 8,
										width: '100%',
									}}
								>
									<TextField
										type="outlined"
										placeholder="Search for a place"
										value={searchQuery}
										style={{ flex: 1, minWidth: 220 }}
										onKeyDown={(event) => {
											if (event.key === 'Enter') {
												event.preventDefault();
												runSearch();
											}
										}}
									/>
									<Button
										type="outlined"
										icon={<Icon name="feather:search" />}
										style={{ margin: 0 }}
										onClick={() => runSearch()}
									/>
								</div>
							</div>
						</mark:anchor>

						<mark:popup>
							<Paper
								style={{
									width: searchAnchorWidth.map(w => Number.isFinite(w) && w > 0 ? w : 320),
									minWidth: 260,
									maxWidth: 520,
									boxSizing: 'border-box',
									maxHeight: 240,
									overflowY: 'auto',
									padding: 10,
								}}
								onPointerDown={e => e.stopPropagation()}
								onTouchStart={e => e.stopPropagation()}
								onMouseDown={e => e.stopPropagation()}
							>
								<Shown value={searchLoading}>
									<Typography type="p2" label="Searching..." />
								</Shown>
								<Shown value={searchError.map(e => !!e)}>
									<Typography type="p2" label={searchError} style={{ color: '$color_error' }} />
								</Shown>
								<Shown value={showEmptyResults}>
									<Typography type="p2" label="No results" />
								</Shown>
								{searchResults.map(results => (results || []).map((result, idx) => (
									<div
										key={idx}
										onClick={() => selectSearchResult(result)}
										style={{
											padding: '6px 4px',
											cursor: 'pointer',
											borderBottom: '1px solid rgba(0,0,0,0.08)',
										}}
									>
										<Typography type="p2" label={result?.label || 'Unknown'} />
										{result?.type ? <Typography type="p3" label={result.type} style={{ opacity: 0.7 }} /> : null}
									</div>
								))).unwrap()}
								<Shown value={searchAttribution.map(a => !!a)}>
									<Typography type="p3" label={searchAttribution} style={{ opacity: 0.6, marginTop: 8 }} />
								</Shown>
							</Paper>
						</mark:popup>
					</Detached>
				</Shown>
			</div>
		</Paper>;

		const overlayControls = renderControls
			? renderControls(api)
			: controls ?? defaultControls;

		return <div theme="mapInput" style={style}>
			{overlayControls}
			<div theme="mapInput_map" style={{ height: mapHeightObserver }}>
				<Map
					{...mapProps}
					center={center}
					zoom={zoom}
					mapRef={mapRef}
					syncCenterFromMap={false}
					onClick={(event, map) => {
						mapProps?.onClick?.(event, map);
						if (!modes.includes('point') && !modes.includes('radius')) return;
						selectPoint(event.latlng);
					}}
				/>
			</div>
		</div>;
	};

	return MapInput;
});
