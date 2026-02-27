import {
	Observer,
	LoadingDots,
	Button,
	Shown,
	Typography,
	Icon,
} from '@destamatic/ui';

const Stasis = () => {
	const timer = Observer.timer(1000);
	return <div
		theme="column_fill"
		style={{
			flex: 1,
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			minHeight: 0,
		}}
	>
		<div style={{ position: 'relative' }}>
			<LoadingDots />

			<Shown value={timer.map(t => t > 5)}>
				<div
					theme="column_center"
					style={{
						position: 'absolute',
						top: '100%',
						left: '50%',
						transform: 'translateX(-50%)',
						marginTop: 100,
						width: 'max-content'
					}}
				>
					<Typography type="h2" label="Stuck?" />
					<div theme="row" style={{ marginTop: 20, gap: 20 }}>
						<Button
							label="Back"
							icon={<Icon name='feather:arrow-left' />}
							type="contained"
							onClick={() => history.back()}
						/>
						<Button
							label="Refresh"
							icon={<Icon name='feather:rotate-cw' />}
							type="contained"
							onClick={() => window.location.reload()}
							iconPosition='right'
						/>
					</div>
				</div>
			</Shown>
		</div>
	</div>
};

export default Stasis;
