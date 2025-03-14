export default () => {
    console.log("child.js is loaded");
    return {
        int: (props) => {
            console.log("child.js is called, with these props: \n", props);
            return props
        }
    };
};
