import { Paper as PaperDUI, ThemeContext } from '@destamatic/ui';

const Paper = ({ children, style, ...props }) => {
	return <PaperDUI style={style} {...props}>
		<ThemeContext value="antiPrimary">
			{children}
		</ThemeContext>
	</PaperDUI>;
};

export default Paper;
