export const deps = ['child'];

export default ({ child }) => {
    console.log(child({ test: "Hi there" }));
};
