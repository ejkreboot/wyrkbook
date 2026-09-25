# Algebra & Trigonometry Chapter 4: Systems of Linear Equations and Inequalities

::: outline
1. Introduction to Linear Systems
    - Two or more equations with the same variables form a [[system]] of equations.
    - Solution of a system: [[2: values of the variables that make every equation in the system true]]
    - Why they are called simultaneous equations: [[2: a solution has to satisfy all of the equations at the same time]]
    - Definitions
        - System: [[3: a set of two or more equations in the same variables]]
        - Solution set: [[3: the set of all solutions of the system, written as ordered pairs]]
2. Solution of Systems of Linear Equations
    - Equivalent systems
        - Example: $2x - y = 10$ and $x + 3y = -9$ [[4: equivalent systems have the same solution set; this one is equivalent to $x = 3$, $y = -4$]]
        - Goal: transform the system to an equivalent system of the form [[3: $x = h$, $y = k$, where the solution can be read off directly]]
        - Writing the answer as a solution set: [[2: $\{(3, -4)\}$]]
    - Eliminating a variable
        - Make the x- or y-coefficients [[equal]] to each other or [[opposites]] of each other.
        - Then [[subtract]] or [[add]] the equations.
    - Names for this method
        - Linear combination: [[2: adding a multiple of one equation to a multiple of the other]]
        - Also called the [[addition]] method or the [[elimination]] method.
        - Other methods from previous courses: [[2: substitution and graphing]]
    - Three possibilities
        - Inconsistent equations: [[2: no solution; the lines are parallel]]
        - Dependent equations: [[2: infinitely many solutions; the lines coincide]]
        - Independent equations: [[2: exactly one solution; the lines cross at one point]]
3. Second-Order Determinants
    - Why use determinants? [[2: they give the solution of any such system straight from its coefficients]]
    - General system: $ax + by = c$, $dx + ey = f$
        - Solve for x by eliminating y: [[3: $x = \dfrac{ce - bf}{ae - bd}$]]
        - Solve for y: [[2: $y = \dfrac{af - cd}{ae - bd}$]]
        - Three patterns [[4: both denominators are $ae - bd$, from the coefficients alone; the x-numerator replaces $a, d$ with $c, f$; the y-numerator replaces $b, e$ with $c, f$]]
    - Second-order determinant
        - Definition: [[3: $\begin{vmatrix} a & b \\ d & e \end{vmatrix} = ae - bd$]]
        - Diagonal multiplication scheme: [[2: the product down the main diagonal minus the product up the other]]
        - $D$ stands for the [[denominator]] determinant.
    - Numerator determinants
        - x-numerator: [[3: $D_x = \begin{vmatrix} c & b \\ f & e \end{vmatrix}$, the constants in place of the x-coefficients]]
        - y-numerator: [[3: $D_y = \begin{vmatrix} a & c \\ d & f \end{vmatrix}$, the constants in place of the y-coefficients]]
        - The solutions are $x =$ [[$\dfrac{D_x}{D}$]] and $y =$ [[$\dfrac{D_y}{D}$]].
    - Solving by determinants is often called [[Cramer's rule]].
:::
