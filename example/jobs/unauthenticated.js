
export default () => {
    return {
        authenticated: false,
        init: (test) => {
            console.log(test)
            console.log("UNAUTHENTICATED");

            return "UNAUTHENTICATED"
        }
    }
};
