import { mount } from 'destam-dom';

window.addEventListener('load', async () => {
    const path = window.location.pathname;

    const content = path === '/'
        ? <div>Hello World</div>
        : <div style={{ color: 'red', fontSize: '24px' }}>NotFound</div>;

    remove = mount(document.body, content);
});
