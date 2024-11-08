
export default () => {
    return {
        authenticated: false,
        init: () => {
            console.log("UNAUTHENTICATED");

            return "Hi there!!!"
        }
    }
};
