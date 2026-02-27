import { TextField, Button, Icon, Observer, Theme } from '@destamatic/ui';

Theme.define({
	actionField: {
		gap: 5,
		overflow: 'clip',
		paddingRight: 5,
	},

	actionField_contained: {
		background: '$color',
		color: '$contrast_text($color_top)',
	},

	actionField_contained_hovered: {
		background: '$color_hover',
	},

	actionField_contained_disabled: {
		background: '$color_disabled',
		color: '$contrast_text($color_disabled)',
	},

	actionField_outlined: {
		borderWidth: 2,
		borderStyle: 'solid',
		color: '$color',
	},

	actionField_outlined_hovered: {
		background: '$color_hover',
	},

	actionField_outlined_disabled: {
		color: '$color_disabled',
	},

	actionField_text: {
		color: '$color',
	},

	actionField_text_hovered: {
		background: '$color_hover',
	},

	actionField_text_disabled: {
		color: '$color_disabled',
	},

	actionField_input: {
		_cssProp_placeholder: {
			color: '$alpha($color, 0.54)',
			opacity: 1,
		},
	},

	actionField_input_contained: {
		_cssProp_placeholder: {
			color: '$alpha($contrast_text($color_top), 0.6)',
		},
	},

	actionField_input_contained_disabled: {
		_cssProp_placeholder: {
			color: '$alpha($contrast_text($color_disabled), 0.6)',
		},
	},

	actionField_input_outlined: {
		_cssProp_placeholder: {
			color: '$alpha($color, 0.54)',
		},
	},

	actionField_input_outlined_disabled: {
		_cssProp_placeholder: {
			color: '$alpha($color_disabled, 0.6)',
		},
	},

	actionField_input_text: {
		_cssProp_placeholder: {
			color: '$alpha($color, 0.54)',
		},
	},

	actionField_input_text_disabled: {
		_cssProp_placeholder: {
			color: '$alpha($color_disabled, 0.6)',
		},
	},
})

const ActionField = ({
	value,
	onAction,
	placeholder,
	disabled,
	textFieldType = 'contained',
	buttonType = 'text',
	icon = <Icon name='feather:plus' style={{ color: 'currentColor' }} />,
}) => {
	if (!(disabled instanceof Observer)) disabled = Observer.mutable(disabled);

	const focused = Observer.mutable(false);
	const wrapperHovered = Observer.mutable(false);
	const buttonHovered = Observer.mutable(false);
	const isContained = textFieldType === 'contained';
	const wrapperBackground = Observer.all([wrapperHovered, disabled]).map(([hovering, isDisabled]) => {
		if (textFieldType === 'contained') return isDisabled
			? '$color_disabled'
			: hovering ? '$color_hover' : '$color';

		if (textFieldType === 'outlined' || textFieldType === 'text') return hovering
			? '$color_hover'
			: 'transparent';

		return 'transparent';
	});
	const textColor = disabled.map(d => {
		if (isContained) return d
			? '$contrast_text($color_disabled)'
			: '$contrast_text($color_top)';

		return d ? '$color_disabled' : '$color';
	});
	const iconColor = Observer.all([disabled, wrapperHovered, buttonHovered]).map(([d]) => {
		if (isContained) return d
			? '$contrast_text($color_disabled)'
			: '$contrast_text($color_top)';

		return d ? '$color_disabled' : '$color';
	});

	return <div
		isHovered={wrapperHovered}
			theme={[
				'row_spread',
				'radius',
				'primary',
				'actionField',
				textFieldType,
				focused.bool('focused', null),
				disabled.bool('disabled', null),
				disabled.map(d => d ? `actionField_${textFieldType}_disabled` : null),
			]}
			style={{ background: wrapperBackground }}
		>
		<TextField
			theme={[
				'fill',
				'primary',
				'actionField_input',
				disabled.bool('disabled', null),
			]}
			type={textFieldType}
			style={{
				background: 'transparent',
				backgroundColor: 'transparent',
				border: 'none',
				outline: 'none',
				appearance: 'none',
				MozAppearance: 'none',
				color: textColor,
				caretColor: textColor,
			}}
			value={value}
			isFocused={focused}
			isHovered={wrapperHovered}
			placeholder={placeholder}
			onKeyDown={event => {

				if (disabled.get()) return;
				if (event.key === 'Enter') {
					event.preventDefault();
					onAction?.(event);
				} else if (event.key === 'Escape') {
					value?.set?.('');
					event.preventDefault();
				}
			}}
			disabled={disabled}
		/>
		<Button
			type={buttonType}
			hover={buttonHovered}
			icon={icon}
			style={{ color: iconColor }}
			onClick={event => {
				if (disabled.get()) return;
				onAction?.(event);
			}}
			disabled={disabled}
		/>
	</div>;
};

export default ActionField;
